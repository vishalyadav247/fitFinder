// Data for the Storefront page's live previews (specs/storefront.md): a few of the shop's own
// filter rows (fitment table sample, the example selections of the badge and My Selection) and,
// for the search widget preview, the products that fit a selection. Scoped by shop.
import type { FieldType } from "@prisma/client";
import prisma from "../../db.server";
import type { FitRow, ShopSearch } from "./query.server";
import { searchResults } from "./query.server";
import type { Picks } from "./picks";

export const SAMPLE_ROWS = 7;
export const PREVIEW_RESULTS = 4;

export interface PreviewSample {
  /** Fitment table sample rows. */
  rows: FitRow[];
  /** Up to two different selections (fieldId → value; a year field takes the first year). */
  selections: Record<string, string>[];
}

/** A row as the selection a shopper would pick for it. */
export function rowSelection(
  fields: { id: string; type: FieldType }[],
  row: FitRow,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (f.type === "year_range") {
      if (row.y) out[f.id] = String(row.y[0]);
    } else if (row.v[f.id]) {
      out[f.id] = row.v[f.id];
    }
  }
  return out;
}

export async function previewSample(
  shopId: string,
  fields: { id: string; type: FieldType }[],
): Promise<PreviewSample> {
  const found = await prisma.fitmentRow.findMany({
    where: { shopId },
    orderBy: { id: "asc" },
    take: SAMPLE_ROWS,
    select: { values: true, yearFrom: true, yearTo: true },
  });
  const rows: FitRow[] = found.map((r) => ({
    v: (r.values ?? {}) as Record<string, string>,
    y: r.yearFrom === null ? null : [r.yearFrom, r.yearTo],
  }));
  const selections: Record<string, string>[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const sel = rowSelection(fields, row);
    const key = JSON.stringify(sel);
    if (!Object.keys(sel).length || seen.has(key)) continue;
    seen.add(key);
    selections.push(sel);
    if (selections.length === 2) break;
  }
  return { rows, selections };
}

export interface PreviewResults {
  titles: string[];
  total: number;
}

/** The first products that fit (titles), as the search widget preview lists them. */
export async function previewResults(
  search: ShopSearch,
  picks: Picks,
): Promise<PreviewResults> {
  const page = await searchResults(search, picks, 1);
  const handles = page.products.slice(0, PREVIEW_RESULTS).map((p) => p.handle);
  const products = handles.length
    ? await prisma.catalogProduct.findMany({
        where: { shopId: search.shopId, handle: { in: handles } },
        select: { handle: true, title: true },
      })
    : [];
  const title = new Map(products.map((p) => [p.handle, p.title]));
  return {
    titles: handles.map((h) => title.get(h) ?? h),
    total: page.total,
  };
}
