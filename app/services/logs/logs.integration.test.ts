// Runs against the real Postgres in DATABASE_URL. Skipped when no database is configured.
// The logs table is shared with the dev database: every entry here names one of this run's shop
// domains, and only those are read or deleted.
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env: rely on the environment
}

const RUN = randomBytes(4).toString("hex");
const A = `vitest-logs-a-${RUN}.myshopify.com`;
const B = `vitest-logs-b-${RUN}.myshopify.com`;

describe.skipIf(!process.env.DATABASE_URL)("logs (Postgres)", async () => {
  const { default: prisma } = await import("../../db.server");
  const logs = await import("./logs.server");
  const { entryFromConsole } = await import("./entry");

  const mine = { shopDomain: { in: [A, B] } };
  const page = (q: Partial<Parameters<typeof logs.listLogs>[0]> = {}) =>
    logs.listLogs({
      level: "all",
      store: A,
      range: "all",
      q: "",
      page: 1,
      pageSize: 10,
      ...q,
    });

  afterEach(async () => {
    await logs.flushLogs();
    await prisma.appLog.deleteMany({ where: mine });
  });
  afterAll(async () => {
    await prisma.appLog.deleteMany({ where: mine });
  });

  it("saves an entry and counts repeats within the hour on one row", async () => {
    const log = (n: number, shop = A) =>
      logs.recordLog(
        entryFromConsole("error", [`import: job ${n} failed`, { shop }]),
      );
    log(1);
    log(2);
    log(3);
    log(4, B);
    await logs.flushLogs();

    const rows = await prisma.appLog.findMany({
      where: mine,
      orderBy: { shopDomain: "asc" },
    });
    expect(rows.map((r) => [r.shopDomain, r.count])).toEqual([
      [A, 3],
      [B, 1],
    ]);
    expect(rows[0].lastAt.getTime()).toBeGreaterThanOrEqual(
      rows[0].firstAt.getTime(),
    );

    // An hour later the same message starts a new row.
    await prisma.appLog.updateMany({
      where: { shopDomain: A },
      data: { lastAt: new Date(Date.now() - 2 * 3_600_000) },
    });
    log(5);
    await logs.flushLogs();
    expect(await prisma.appLog.count({ where: { shopDomain: A } })).toBe(2);
  });

  it("names a shop logged by its id, so the purge deletes the entry with the shop", async () => {
    const shop = await prisma.shop.upsert({
      where: { domain: A },
      create: { domain: A },
      update: {},
    });
    try {
      logs.recordLog(
        entryFromConsole("error", [
          "billing: plan read failed",
          { shopId: shop.id },
        ]),
      );
      await logs.flushLogs();
      const [row] = await prisma.appLog.findMany({ where: { shopDomain: A } });
      expect(row).toMatchObject({ source: "billing", shopDomain: A });
    } finally {
      await prisma.shop.delete({ where: { id: shop.id } });
    }
  });

  it("a full queue drops entries and reports them once; a failed write only prints", async () => {
    for (let i = 0; i < 230; i++) {
      logs.recordLog(
        entryFromConsole("warn", [`import: flood ${RUN}`, { shop: A }]),
      );
    }
    await logs.flushLogs();
    await logs.flushLogs();
    const [row] = await prisma.appLog.findMany({ where: { shopDomain: A } });
    expect(row.count).toBe(200);
    const report = await prisma.appLog.findMany({
      where: { message: "logs: 30 entries weren't saved (too many at once)" },
    });
    expect(report.length).toBeGreaterThanOrEqual(1);
    await prisma.appLog.deleteMany({
      where: { id: { in: report.map((r) => r.id) } },
    });

    const printed: unknown[] = [];
    const before = globalThis.sparefitLogCapture;
    globalThis.sparefitLogCapture = {
      error: (...a: unknown[]) => printed.push(a),
      warn: () => {},
    };
    try {
      // An entry the database refuses (unknown level).
      logs.recordLog({
        ...entryFromConsole("error", ["x: y", { shop: A }]),
        level: "nope" as never,
      });
      await logs.flushLogs();
    } finally {
      globalThis.sparefitLogCapture = before;
    }
    expect(printed).toEqual([["logs: entry not saved", expect.anything()]]);
  });

  it("slow entries keep the slowest duration", async () => {
    const slow = (durationMs: number) => ({
      level: "slow" as const,
      source: "request",
      message: "Slow request: GET /app",
      detail: null,
      shopDomain: A,
      path: "/app",
      durationMs,
      fingerprint: `slow-${RUN}`,
    });
    await logs.writeLog(slow(4000));
    await logs.writeLog(slow(9000));
    await logs.writeLog(slow(3500));
    const [row] = await prisma.appLog.findMany({ where: { shopDomain: A } });
    expect(row).toMatchObject({ count: 3, durationMs: 9000 });
  });

  it("lists entries by level, store, text and time, with counts per level", async () => {
    const now = Date.now();
    await prisma.appLog.createMany({
      data: [
        { level: "error", message: "storefront: publish failed", at: 1 },
        { level: "warn", message: "import: odd column", at: 2 },
        { level: "slow", message: "Slow request: GET /app", at: 3 },
        { level: "error", message: "linking: old one", at: 48 },
      ].map((e, i) => ({
        level: e.level as "error" | "warn" | "slow",
        source: e.message.split(":")[0],
        message: e.message,
        shopDomain: A,
        fingerprint: `list-${RUN}-${i}`,
        firstAt: new Date(now - e.at * 3_600_000),
        lastAt: new Date(now - e.at * 3_600_000),
      })),
    });
    await prisma.appLog.create({
      data: {
        level: "error",
        source: "storefront",
        message: "storefront: publish failed",
        shopDomain: B,
        fingerprint: `list-${RUN}-b`,
      },
    });

    const all = await page();
    expect(all.total).toBe(4);
    expect(all.counts).toEqual({ error: 2, warn: 1, slow: 1 });
    // Newest last seen first.
    expect(all.rows.map((r) => r.message)[0]).toBe(
      "storefront: publish failed",
    );
    expect((await page({ level: "error" })).total).toBe(2);
    expect((await page({ level: "slow" })).rows[0].message).toBe(
      "Slow request: GET /app",
    );
    const day = await page({ range: "24h" });
    expect(day.total).toBe(3);
    expect(day.counts).toEqual({ error: 1, warn: 1, slow: 1 });
    expect((await page({ q: "COLUMN" })).total).toBe(1);
    expect((await page({ q: "linking" })).total).toBe(1);
    expect((await page({ store: B })).total).toBe(1);
    expect((await page({ pageSize: 10, page: 2 })).rows).toHaveLength(0);
    expect(await logs.logStores()).toEqual(expect.arrayContaining([A, B]));
  });

  it("deletes entries older than the retention", async () => {
    const now = new Date();
    const old = (days: number, i: number) => ({
      level: "warn" as const,
      source: "test",
      message: `old ${days}`,
      shopDomain: A,
      fingerprint: `old-${RUN}-${i}`,
      firstAt: new Date(now.getTime() - days * 86_400_000),
      lastAt: new Date(now.getTime() - days * 86_400_000),
    });
    await prisma.appLog.createMany({
      data: [old(1, 1), old(10, 2), old(20, 3), old(40, 4)],
    });
    const days = await logs.getLogRetentionDays();
    expect([7, 14, 30]).toContain(days);
    const removed = await logs.purgeOldLogs(now, { only: [A] });
    const left = await prisma.appLog.findMany({
      where: { shopDomain: A },
      select: { message: true },
      orderBy: { lastAt: "desc" },
    });
    const kept = [1, 10, 20, 40].filter((d) => d < days);
    expect(left.map((r) => r.message)).toEqual(kept.map((d) => `old ${d}`));
    expect(removed).toBe(4 - kept.length);
  });

  it("console capture keeps printing and records warnings and errors", async () => {
    const printed: unknown[][] = [];
    const fake = {
      error: (...a: unknown[]) => printed.push(["error", ...a]),
      warn: (...a: unknown[]) => printed.push(["warn", ...a]),
      log: () => {},
    } as unknown as Console;
    const before = globalThis.sparefitLogCapture;
    globalThis.sparefitLogCapture = undefined;
    try {
      logs.installLogCapture(fake);
      fake.error("storefront: capture test", { shop: A });
      fake.warn("import: capture warning", { shop: A });
      fake.warn("⚠️  Future Flag Warning: ignored");
      await logs.flushLogs();
    } finally {
      globalThis.sparefitLogCapture = before;
    }
    expect(printed).toHaveLength(3);
    const rows = await prisma.appLog.findMany({
      where: { shopDomain: A },
      orderBy: { level: "asc" },
      select: { level: true, source: true, message: true },
    });
    expect(rows).toEqual([
      {
        level: "error",
        source: "storefront",
        message: "storefront: capture test",
      },
      { level: "warn", source: "import", message: "import: capture warning" },
    ]);
  });
});
