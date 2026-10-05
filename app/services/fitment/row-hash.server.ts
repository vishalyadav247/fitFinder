import { Prisma } from "@prisma/client";

/** SQL expressions for a fitment row's content, relative to a table alias. */
export interface RowContent {
  values: (alias: string) => Prisma.Sql;
  yearFrom: (alias: string) => Prisma.Sql;
  yearTo: (alias: string) => Prisma.Sql;
}

export const col = (alias: string, name: string) =>
  Prisma.raw(`${alias}."${name}"`);

/** The row as stored. */
export const CURRENT: RowContent = {
  values: (a) => col(a, "values"),
  yearFrom: (a) => col(a, "year_from"),
  yearTo: (a) => col(a, "year_to"),
};

/**
 * row_hash = md5 of the row's canonical content: jsonb `values` (Postgres stores jsonb with sorted
 * keys, so its text form is canonical) + years + attachment. Computed in SQL so every writer (field
 * changes now, the import engine in M4) produces the same hash.
 */
export function rowHashSql(c: RowContent, alias: string): Prisma.Sql {
  return Prisma.sql`md5(
    (${c.values(alias)})::text || '|' || coalesce((${c.yearFrom(alias)})::text, '') || '|' ||
    coalesce((${c.yearTo(alias)})::text, '') || '|' || ${col(alias, "attachment")}
  )`;
}

/**
 * Rewrites a shop's rows to new content and rehashes them. Rows that would become duplicates
 * (same new content and attachment) are deleted first, keeping the lowest id, so the unique
 * (shop_id, row_hash) index holds. One sort pass (window function), not a self-join, so large
 * duplicate groups stay linear. `onlyWhere` limits the UPDATE to rows whose content changes; for
 * every other row `next` must equal its current content. Returns the number of rows removed.
 */
export async function rewriteRows(
  tx: Prisma.TransactionClient,
  shopId: string,
  next: RowContent,
  onlyWhere: (alias: string) => Prisma.Sql = () => Prisma.sql`true`,
): Promise<number> {
  const removed = await tx.$executeRaw`
    DELETE FROM fitment_rows WHERE id IN (
      SELECT id FROM (
        SELECT r.id, row_number() OVER (
          PARTITION BY r.attachment, ${next.values("r")}, ${next.yearFrom("r")}, ${next.yearTo("r")}
          ORDER BY r.id
        ) AS n
        FROM fitment_rows r
        WHERE r.shop_id = ${shopId}
      ) ranked
      WHERE n > 1
    )`;

  await tx.$executeRaw`
    UPDATE fitment_rows r SET
      "values" = ${next.values("r")},
      year_from = ${next.yearFrom("r")},
      year_to = ${next.yearTo("r")},
      row_hash = ${rowHashSql(next, "r")},
      updated_at = now()
    WHERE r.shop_id = ${shopId} AND ${onlyWhere("r")}`;

  return removed;
}
