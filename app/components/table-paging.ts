// The admin's standard for paged tables (agreed 2026-10-06): 10 rows per page by default,
// 10 / 25 / 50 to choose from (TableFooter). Pure, so routes, APIs and models share it.

export const TABLE_PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_TABLE_PAGE_SIZE = 10;

/** A rows-per-page value from a URL or request: one of TABLE_PAGE_SIZES, else the default. */
export function tablePageSize(raw: unknown): number {
  const n = Number(raw);
  return (TABLE_PAGE_SIZES as readonly number[]).includes(n)
    ? n
    : DEFAULT_TABLE_PAGE_SIZE;
}
