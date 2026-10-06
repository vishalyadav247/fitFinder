// Filter rows on the Filter data page (specs/fitment-data.md): browse and search, add and edit,
// delete (selected / all), remove duplicates, export. Every query is scoped by shop. Writes lock
// the shop's search_configs row first, like field changes (M3) and imports (M4), so they can't
// interleave with a field type change rewriting the rows or an import applying its file.
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../db.server";
import { CURRENT, rowHashSql } from "../services/fitment/row-hash.server";
import { sweepStale } from "../services/import/pipeline.server";
import {
  MAX_SELECTED,
  parseRowForm,
  type RowField,
  type RowView,
} from "../services/fitment/rows";
import { overLimitMessage } from "../services/billing.server";

type Tx = Prisma.TransactionClient;

export const PAGE_SIZE = 50;
/** Most rows one bulk delete or "Selected rows" export takes. */
export const MAX_QUERY = 100;
// Delete all and Remove duplicates touch every row (about 1 s and 7 s for 727k rows locally).
const TX_OPTIONS = { timeout: 120_000, maxWait: 10_000 };
const STATEMENT_TIMEOUT = "110s";
const LOCK_TIMEOUT = "10s";
const EXPORT_BATCH = 5000;

export { MAX_SELECTED };

/** A problem the merchant can act on; the message is shown as an error toast. */
export class FitmentRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FitmentRuleError";
  }
}

export const rowIdsSchema = z
  .array(z.string().regex(/^[0-9]{1,19}$/))
  .min(1)
  .max(MAX_SELECTED)
  .transform((ids) => [...new Set(ids)].map((id) => BigInt(id)));

/** Filter data page actions (app.filter-data.tsx). Add/edit read the field values from the form. */
export const filterDataIntentSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("add") }),
  z.object({
    intent: z.literal("edit"),
    rowId: z.string().regex(/^\d{1,19}$/),
  }),
  z.object({
    intent: z.literal("delete"),
    // "1" when one row was deleted with its own delete icon (toast "Row deleted").
    single: z.literal("1").optional(),
    ids: z
      .string()
      .transform((s, ctx) => {
        try {
          return JSON.parse(s) as unknown;
        } catch {
          ctx.addIssue({ code: "custom", message: "ids" });
          return z.NEVER;
        }
      })
      .pipe(rowIdsSchema),
  }),
  z.object({ intent: z.literal("delete-all") }),
  z.object({ intent: z.literal("dedupe-count") }),
  z.object({ intent: z.literal("dedupe") }),
]);

export async function listRowFields(shopId: string): Promise<RowField[]> {
  return prisma.searchField.findMany({
    where: { shopId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, label: true, type: true, required: true },
  });
}

// ------------------------------------------------------------------ read

/** A row is linked when Product mapping has a link for its attachment (M6 fills product_links). */
const linkedSql = (alias: string) =>
  Prisma.sql`EXISTS (SELECT 1 FROM product_links p
    WHERE p.shop_id = ${Prisma.raw(alias)}.shop_id AND p.attachment = ${Prisma.raw(alias)}.attachment)`;

export interface RowCounts {
  total: number;
  unlinkedRows: number;
  /** Distinct attachments without a product link (the banner's "{n} SKUs"). */
  unlinkedSkus: number;
  /** Distinct attachments (Dashboard: "{pct}% of SKUs linked"). */
  skus: number;
}

/**
 * A join, not EXISTS per row: one merge pass (0.7 s for 727k rows vs 7 s). product_links is
 * unique per (shop_id, attachment), so the join can't count a row twice.
 */
export async function rowCounts(shopId: string): Promise<RowCounts> {
  const [r] = await prisma.$queryRaw<RowCounts[]>`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE p.attachment IS NULL)::int AS "unlinkedRows",
           count(DISTINCT f.attachment) FILTER (WHERE p.attachment IS NULL)::int AS "unlinkedSkus",
           count(DISTINCT f.attachment)::int AS skus
    FROM fitment_rows f
    LEFT JOIN product_links p ON p.shop_id = f.shop_id AND p.attachment = f.attachment
    WHERE f.shop_id = ${shopId}`;
  return r;
}

/** LIKE pattern for a typed query: wildcards in it are literal. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * What the search box matches: every field value, the years as "2008-2011" and the attachment.
 * A sequential scan of the shop's rows (~0.75 s for 727k rows); a trigram index made 1–2 letter
 * queries slower and every import heavier, so there is none (PROGRESS.md, M5).
 */
const searchText = (alias: string) => {
  const a = Prisma.raw(alias);
  return Prisma.sql`(jsonb_path_query_array(${a}."values", '$.*')::text || ' ' ||
    coalesce(${a}.year_from::text, '') || '-' || coalesce(${a}.year_to::text, '') || ' ' ||
    ${a}.attachment)`;
};

interface DbRow {
  id: bigint;
  values: Record<string, string>;
  year_from: number | null;
  year_to: number | null;
  attachment: string;
  linked: boolean;
}

const toView = (r: DbRow): RowView => ({
  id: r.id.toString(),
  values: r.values,
  yearFrom: r.year_from,
  yearTo: r.year_to,
  attachment: r.attachment,
  linked: r.linked,
});

export interface RowPage {
  rows: RowView[];
  page: number;
  hasNextPage: boolean;
  /** Rows matching the query; null without a query (the total is in RowCounts). */
  matching: number | null;
}

const READ_TIMEOUT = "8s";

/** A read with a statement timeout; a timeout becomes a message the merchant can act on. */
async function timedRead<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `SET LOCAL statement_timeout = '${READ_TIMEOUT}'`,
        );
        return work(tx);
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
  } catch (error) {
    const code = sqlState(error);
    if (code === "57014" || code === "P2028") {
      throw new FitmentRuleError(
        "This search took too long. Try a longer or more exact search.",
      );
    }
    throw error;
  }
}

/** One page of rows, newest first, optionally filtered by a search query. */
export async function listRows(
  shopId: string,
  { q = "", page = 1 }: { q?: string; page?: number },
): Promise<RowPage> {
  const query = q.trim().slice(0, MAX_QUERY);
  const filter = query
    ? Prisma.sql`AND ${searchText("f")} ILIKE ${likePattern(query)}`
    : Prisma.empty;
  const offset = (page - 1) * PAGE_SIZE;
  // Each typed query scans the shop's rows; stop runaway scans (huge shops, a browser that
  // already moved on) instead of letting them load the shared database.
  const [rows, matching] = await Promise.all([
    timedRead(
      (tx) => tx.$queryRaw<DbRow[]>`
        SELECT f.id, f."values", f.year_from, f.year_to, f.attachment, ${linkedSql("f")} AS linked
        FROM fitment_rows f
        WHERE f.shop_id = ${shopId} ${filter}
        ORDER BY f.id DESC
        LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`,
    ),
    query
      ? timedRead(
          (tx) => tx.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS n FROM fitment_rows f
            WHERE f.shop_id = ${shopId} ${filter}`,
        ).then(([r]) => r.n)
      : Promise.resolve(null),
  ]);
  return {
    rows: rows.slice(0, PAGE_SIZE).map(toView),
    page,
    hasNextPage: rows.length > PAGE_SIZE,
    matching,
  };
}

// ------------------------------------------------------------------ write

/** Runs a write under the shop's setup lock, with timeouts that say "nothing changed". */
async function withSetupLock<T>(
  shopId: string,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`,
      );
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
      // An import holds the lock while it writes: say so instead of waiting. Imports whose worker
      // died are failed first, so they don't block edits.
      await sweepStale(shopId);
      const running = await tx.importJob.count({
        where: { shopId, status: "running" },
      });
      if (running > 0) {
        throw new FitmentRuleError(
          "An import is running. Try again when it has finished.",
        );
      }
      const locked = await tx.$queryRaw<unknown[]>`
        UPDATE search_configs SET data_version = data_version + 1
        WHERE shop_id = ${shopId} RETURNING 1`;
      if (locked.length === 0) {
        throw new FitmentRuleError("Set up your store first.");
      }
      return work(tx);
    }, TX_OPTIONS);
  } catch (error) {
    if (error instanceof FitmentRuleError) throw error;
    const code = sqlState(error);
    if (code === "55P03") {
      throw new FitmentRuleError(
        "Your filter data is being changed right now. Try again in a moment.",
      );
    }
    if (code === "57014" || code === "P2028") {
      throw new FitmentRuleError(
        "This took too long for the amount of filter data and was cancelled. Nothing was changed.",
      );
    }
    throw error;
  }
}

/** SQLSTATE of a raw-query error (or Prisma's own code), if any. */
function sqlState(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2028") return "P2028";
    const m = JSON.stringify(error.meta ?? {}).match(/\b(23505|55P03|57014)\b/);
    return m ? m[1] : error.code;
  }
  if (error instanceof Error) {
    return error.message.match(/\b(23505|55P03|57014)\b/)?.[1] ?? null;
  }
  return null;
}

export type SaveRowResult =
  // previous: the edited row's attachment before the change (to relink it too)
  | { ok: true; attachment: string; previous?: string }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * Adds a row (rowId null) or replaces an existing one with the form's values. The form is read
 * against the fields as they are under the lock. A row with the same content as another one is
 * refused (rows are unique per shop by row_hash).
 */
export async function saveRow(
  shopId: string,
  rowId: bigint | null,
  form: Record<string, string | undefined>,
): Promise<SaveRowResult> {
  try {
    return await withSetupLock(shopId, async (tx) => {
      const fields = await tx.searchField.findMany({
        where: { shopId },
        select: { id: true, label: true, type: true, required: true },
      });
      const parsed = parseRowForm(form, fields);
      if (!parsed.ok) return parsed;
      const { values, yearFrom, yearTo, attachment } = parsed.row;
      const content = Prisma.sql`SELECT ${JSON.stringify(values)}::jsonb AS "values",
        ${yearFrom}::int AS year_from, ${yearTo}::int AS year_to, ${attachment}::text AS attachment`;

      if (rowId === null) {
        const over = await overLimitMessage(
          shopId,
          "rows",
          async () => (await tx.fitmentRow.count({ where: { shopId } })) + 1,
          tx,
        );
        if (over) throw new FitmentRuleError(over);
        const added = await tx.$queryRaw<{ id: bigint }[]>`
          INSERT INTO fitment_rows (shop_id, "values", year_from, year_to, attachment, row_hash, updated_at)
          SELECT ${shopId}, s."values", s.year_from, s.year_to, s.attachment, ${rowHashSql(CURRENT, "s")}, now()
          FROM (${content}) s
          ON CONFLICT (shop_id, row_hash) DO NOTHING
          RETURNING id`;
        if (added.length === 0) {
          throw new FitmentRuleError("This row already exists.");
        }
        return { ok: true as const, attachment };
      }

      const before = await tx.fitmentRow.findFirst({
        where: { id: rowId, shopId },
        select: { attachment: true },
      });
      const updated = await tx.$executeRaw`
        UPDATE fitment_rows f SET
          "values" = s."values", year_from = s.year_from, year_to = s.year_to,
          attachment = s.attachment, row_hash = ${rowHashSql(CURRENT, "s")}, updated_at = now()
        FROM (${content}) s
        WHERE f.id = ${rowId} AND f.shop_id = ${shopId}`;
      if (updated === 0 || !before) {
        throw new FitmentRuleError("This row no longer exists.");
      }
      return { ok: true as const, attachment, previous: before.attachment };
    });
  } catch (error) {
    if (sqlState(error) === "23505") {
      throw new FitmentRuleError("Another row already has these values.");
    }
    throw error;
  }
}

/** Deletes the given rows of this shop; returns how many were deleted. */
export function deleteRows(shopId: string, ids: bigint[]): Promise<number> {
  return withSetupLock(
    shopId,
    (tx) => tx.$executeRaw`
      DELETE FROM fitment_rows WHERE shop_id = ${shopId} AND id = ANY(${ids}::bigint[])`,
  );
}

export function deleteAllRows(shopId: string): Promise<number> {
  return withSetupLock(
    shopId,
    (tx) => tx.$executeRaw`DELETE FROM fitment_rows WHERE shop_id = ${shopId}`,
  );
}

/**
 * Duplicates: rows equal to an older row apart from upper/lower case and spaces in the values
 * and the attachment (decided 2026-10-05; exact copies can't exist, row_hash is unique). The
 * oldest row of each group is kept.
 */
const duplicatesSql = (shopId: string) => Prisma.sql`
  SELECT id FROM (
    SELECT id, row_number() OVER (
      PARTITION BY md5(regexp_replace(lower("values"::text || '|' || attachment), '[[:space:]]+', '', 'g')),
                   year_from, year_to
      ORDER BY id
    ) AS n
    FROM fitment_rows WHERE shop_id = ${shopId}
  ) ranked WHERE n > 1`;

export async function countDuplicates(shopId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`,
    );
    const [r] = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (${duplicatesSql(shopId)}) d`;
    return r.n;
  }, TX_OPTIONS);
}

export function removeDuplicates(shopId: string): Promise<number> {
  return withSetupLock(
    shopId,
    (tx) => tx.$executeRaw`
      DELETE FROM fitment_rows WHERE shop_id = ${shopId} AND id IN (${duplicatesSql(shopId)})`,
  );
}

// ------------------------------------------------------------------ export

export type ExportScope = "all" | "selected" | "unmatched";

function scopeFilter(scope: ExportScope, ids: bigint[]) {
  if (scope === "selected") return Prisma.sql`AND f.id = ANY(${ids}::bigint[])`;
  if (scope === "unmatched") return Prisma.sql`AND NOT ${linkedSql("f")}`;
  return Prisma.empty;
}

export async function countExport(
  shopId: string,
  scope: ExportScope,
  ids: bigint[] = [],
): Promise<number> {
  const [r] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM fitment_rows f
    WHERE f.shop_id = ${shopId} ${scopeFilter(scope, ids)}`;
  return r.n;
}

/** The rows of an export, oldest first, in batches (keyset by id). */
export async function* exportRows(
  shopId: string,
  scope: ExportScope,
  ids: bigint[] = [],
): AsyncGenerator<RowView[]> {
  let after = BigInt(0);
  for (;;) {
    const rows = await prisma.$queryRaw<DbRow[]>`
      SELECT f.id, f."values", f.year_from, f.year_to, f.attachment, false AS linked
      FROM fitment_rows f
      WHERE f.shop_id = ${shopId} AND f.id > ${after} ${scopeFilter(scope, ids)}
      ORDER BY f.id
      LIMIT ${EXPORT_BATCH}`;
    if (rows.length === 0) return;
    yield rows.map(toView);
    after = rows[rows.length - 1].id;
  }
}
