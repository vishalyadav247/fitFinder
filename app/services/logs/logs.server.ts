// Backoffice › Logs (specs/backoffice.md): stores the app's warnings, errors and slow requests,
// lists them for the Logs page and deletes them after the retention the super admin set.
//
// Writing a log never holds up or breaks the request that logged it: entries go through one
// in-process queue (at most MAX_PENDING waiting; more are counted and reported as one warning),
// and a failed write only goes to the server console. Repeats of the same entry within an hour
// update one row (count, last seen) instead of adding rows, so an outage can't flood the table.
import { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import {
  DEFAULT_LOG_RETENTION_DAYS,
  LOG_RETENTION_DAYS,
  type LOG_LEVELS,
  type LOG_RANGES,
} from "../backoffice-shared";
import { entryFromConsole, fingerprint, ignored, type LogEntry } from "./entry";

const MAX_PENDING = 200;
const GROUP_WINDOW = Prisma.sql`interval '1 hour'`;
const RETENTION_KEY = "logRetentionDays";
const PURGE_BATCH = 5000;

declare global {
  // eslint-disable-next-line no-var
  var sparefitLogCapture:
    { error: typeof console.error; warn: typeof console.warn } | undefined;
}

/** The console before capture was installed (a failed write is reported there, not logged). */
const plain = () => globalThis.sparefitLogCapture ?? console;

let queue: Promise<void> = Promise.resolve();
let pending = 0;
let dropped = 0;

/**
 * Saves an entry in the background, after the ones before it. `entry` may be a function, so a
 * full queue drops it before any work is done to build it.
 */
export function recordLog(entry: LogEntry | (() => LogEntry)): void {
  if (pending >= MAX_PENDING) {
    dropped++;
    return;
  }
  const built = typeof entry === "function" ? entry() : entry;
  pending++;
  queue = queue
    .then(() => writeLog(built))
    .catch((error) => plain().error("logs: entry not saved", error))
    .finally(() => {
      pending--;
    })
    .then(async () => {
      // Report what was dropped once the queue has room again.
      if (dropped && pending === 0) {
        const n = dropped;
        dropped = 0;
        const message = `logs: ${n} entries weren't saved (too many at once)`;
        await writeLog({
          level: "warn",
          source: "logs",
          message,
          detail: null,
          shopDomain: null,
          path: null,
          durationMs: null,
          fingerprint: fingerprint({
            level: "warn",
            source: "logs",
            message,
            shopDomain: null,
          }),
        }).catch(() => {});
      }
    });
}

/** Waits until every queued entry is written (tests, and a clean shutdown). */
export async function flushLogs() {
  await queue;
}

export async function writeLog({ shopId, ...entry }: LogEntry) {
  // A repeat within the hour: one more on the newest matching row.
  const updated = await prisma.$executeRaw`
    UPDATE app_logs SET
      count = count + 1,
      last_at = now(),
      detail = COALESCE(${entry.detail}, detail),
      path = COALESCE(${entry.path}, path),
      duration_ms = GREATEST(duration_ms, ${entry.durationMs}::int)
    WHERE id = (
      SELECT id FROM app_logs
      WHERE fingerprint = ${entry.fingerprint} AND last_at > now() - ${GROUP_WINDOW}
      ORDER BY last_at DESC LIMIT 1)`;
  if (updated > 0) return;
  // Logged with the shop's id only: name the shop (and so the purge deletes it with the shop).
  if (!entry.shopDomain && shopId) {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { domain: true },
    });
    entry.shopDomain = shop?.domain ?? null;
  }
  await prisma.appLog.create({ data: entry });
}

/**
 * Copies console.error and console.warn into the logs (they still print as before). Once per
 * process; the web server calls it in entry.server.tsx, the job worker in scripts/worker.ts.
 * LOG_CAPTURE=false turns it off.
 */
export function installLogCapture(target: Console = console) {
  if (globalThis.sparefitLogCapture || process.env.LOG_CAPTURE === "false") {
    return;
  }
  const original = {
    error: target.error.bind(target),
    warn: target.warn.bind(target),
  };
  globalThis.sparefitLogCapture = original;
  for (const level of ["error", "warn"] as const) {
    target[level] = (...args: unknown[]) => {
      original[level](...args);
      try {
        if (!ignored(args)) recordLog(() => entryFromConsole(level, args));
      } catch (error) {
        original.error("logs: couldn't read a log call", error);
      }
    };
  }
}

// ------------------------------------------------------------------ retention

export async function getLogRetentionDays(): Promise<number> {
  const row = await prisma.backofficeSetting.findUnique({
    where: { key: RETENTION_KEY },
  });
  const days = Number(row?.value);
  return (LOG_RETENTION_DAYS as readonly number[]).includes(days)
    ? days
    : DEFAULT_LOG_RETENTION_DAYS;
}

/** Saves the retention and deletes what is now older than it. */
export async function setLogRetentionDays(
  days: (typeof LOG_RETENTION_DAYS)[number],
) {
  await prisma.backofficeSetting.upsert({
    where: { key: RETENTION_KEY },
    create: { key: RETENTION_KEY, value: days },
    update: { value: days },
  });
  return purgeOldLogs();
}

/**
 * Deletes entries last seen before the retention (daily purge job, and on a retention change).
 * `only`: just these shops' entries (tests on the shared database).
 */
export async function purgeOldLogs(
  now = new Date(),
  { only }: { only?: string[] } = {},
): Promise<number> {
  const days = await getLogRetentionDays();
  const before = new Date(now.getTime() - days * 86_400_000);
  const scope = only
    ? Prisma.sql`AND shop_domain = ANY(${only})`
    : Prisma.empty;
  // In batches: a shorter retention on a big table is many short deletes, not one long one.
  let total = 0;
  for (;;) {
    const n = await prisma.$executeRaw`
      DELETE FROM app_logs WHERE id IN (
        SELECT id FROM app_logs WHERE last_at < ${before} ${scope} LIMIT ${PURGE_BATCH})`;
    total += n;
    if (n < PURGE_BATCH) return total;
  }
}

// ------------------------------------------------------------------ Logs page

export interface LogQuery {
  level: (typeof LOG_LEVELS)[number];
  /** A shop domain, "none" (app-wide entries) or "all". */
  store: string;
  range: (typeof LOG_RANGES)[number];
  /** Text in the message, source or path. */
  q: string;
  page: number;
  pageSize: number;
}

export interface LogRow {
  id: string;
  level: "error" | "warn" | "slow";
  source: string;
  message: string;
  detail: string | null;
  shopDomain: string | null;
  path: string | null;
  durationMs: number | null;
  count: number;
  firstAt: string;
  lastAt: string;
}

const RANGE_MS: Record<LogQuery["range"], number | null> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  all: null,
};

/** One page of entries (newest last seen first), and the counts per level for the filter. */
export async function listLogs(query: LogQuery, now = new Date()) {
  const since = RANGE_MS[query.range];
  const where: Prisma.AppLogWhereInput = {
    ...(since ? { lastAt: { gte: new Date(now.getTime() - since) } } : {}),
    ...(query.store === "none"
      ? { shopDomain: null }
      : query.store !== "all"
        ? { shopDomain: query.store }
        : {}),
    ...(query.q
      ? {
          OR: [
            { message: { contains: query.q, mode: "insensitive" } },
            { source: { contains: query.q, mode: "insensitive" } },
            { path: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const levelWhere = {
    ...where,
    ...(query.level !== "all" ? { level: query.level } : {}),
  };
  const [total, rows, byLevel] = await Promise.all([
    prisma.appLog.count({ where: levelWhere }),
    prisma.appLog.findMany({
      where: levelWhere,
      orderBy: [{ lastAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.appLog.groupBy({ by: ["level"], where, _count: { _all: true } }),
  ]);
  const counts = { error: 0, warn: 0, slow: 0 };
  for (const r of byLevel) counts[r.level] = r._count._all;
  return {
    rows: rows.map((r): LogRow => ({
      ...r,
      firstAt: r.firstAt.toISOString(),
      lastAt: r.lastAt.toISOString(),
    })),
    total,
    counts,
  };
}

/** Stores that have entries in the time range, for the store filter (most recent first). */
export async function logStores(
  range: LogQuery["range"] = "all",
  now = new Date(),
  limit = 500,
): Promise<string[]> {
  const since = RANGE_MS[range];
  const from = since ? new Date(now.getTime() - since) : new Date(0);
  const rows = await prisma.$queryRaw<{ shop_domain: string }[]>`
    SELECT shop_domain FROM app_logs
    WHERE shop_domain IS NOT NULL AND last_at >= ${from}
    GROUP BY shop_domain ORDER BY max(last_at) DESC LIMIT ${limit}`;
  return rows.map((r) => r.shop_domain);
}
