// Storefront reads behind the app proxy (specs/storefront.md, data-model.md › Storefront API):
//   options — values for the next dropdown, given the picks of the fields before it;
//   fits    — the fits badge state and fitment table rows of one product;
//   results — the products (and collections) that fit a full selection.
// Matching rules: a list pick matches the row's value exactly; a year pick matches when it lies in
// the row's year range (open range = up to now). For optional fields a row without a value
// matches any pick (a part without an engine fits every engine). Every query is scoped by shop.
import { Prisma, type FieldType } from "@prisma/client";
import prisma from "../../db.server";
import { withQuerySlot } from "./limits.server";
import {
  picksBefore,
  picksKey,
  sortOptions,
  type PickField,
  type Picks,
} from "./picks";

type Tx = Prisma.TransactionClient;

export interface ShopSearch {
  shopId: string;
  dataVersion: number;
  fields: (PickField & { label: string })[];
}

const READ_TIMEOUT = "8s";
export const MAX_OPTIONS = 5000;
export const MAX_TABLE_ROWS = 1000;
export const RESULTS_PAGE_SIZE = 16; // Liquid all_products: 20 unique handles per page
export const MAX_COLLECTIONS = 10;

/**
 * Reads with a statement timeout, so a pathological query can't hold a connection, and in one of
 * the process's storefront query slots (limits.server.ts), so storefront traffic can't take every
 * database connection.
 */
function timedRead<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return withQuerySlot(() =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL statement_timeout = '${READ_TIMEOUT}'`,
      );
      return work(tx);
    }),
  );
}

/** The installed shop's search setup, or null (unknown, uninstalled or not set up). */
export async function shopSearch(domain: string): Promise<ShopSearch | null> {
  // One statement (every proxy request runs it): Prisma's nested select took three.
  const [shop] = await prisma.$queryRaw<
    { id: string; data_version: number; fields: ShopSearch["fields"] }[]
  >`
    SELECT s.id, c.data_version,
           coalesce(json_agg(json_build_object(
             'id', f.id, 'label', f.label, 'type', f.type, 'required', f.required)
             ORDER BY f.position, f.id) FILTER (WHERE f.id IS NOT NULL), '[]') AS fields
    FROM shops s
    JOIN search_configs c ON c.shop_id = s.id
    LEFT JOIN search_fields f ON f.shop_id = s.id
    WHERE s.domain = ${domain} AND s.uninstalled_at IS NULL
    GROUP BY s.id, c.data_version`;
  if (!shop) return null;
  return {
    shopId: shop.id,
    dataVersion: shop.data_version,
    fields: shop.fields,
  };
}

const currentYear = () => new Date().getUTCFullYear();

/** WHERE conditions (alias f) for the picks. Required list picks use one GIN containment. */
export function picksWhere(fields: PickField[], picks: Picks): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  const contained: Record<string, string> = {};
  for (const field of fields) {
    const pick = picks.get(field.id);
    if (pick === undefined) continue;
    if (field.type === "year_range") {
      const inRange = Prisma.sql`(f.year_from <= ${pick}::int
        AND (f.year_to IS NULL OR f.year_to >= ${pick}::int))`;
      parts.push(
        field.required
          ? inRange
          : Prisma.sql`(f.year_from IS NULL OR ${inRange})`,
      );
    } else if (field.required) {
      contained[field.id] = String(pick);
    } else {
      parts.push(Prisma.sql`(f."values" @> ${JSON.stringify({ [field.id]: String(pick) })}::jsonb
        OR NOT jsonb_exists(f."values", ${field.id}))`);
    }
  }
  if (Object.keys(contained).length) {
    parts.unshift(
      Prisma.sql`f."values" @> ${JSON.stringify(contained)}::jsonb`,
    );
  }
  return parts.length
    ? Prisma.sql`AND ${Prisma.join(parts, " AND ")}`
    : Prisma.empty;
}

// ---------------------------------------------------------------- options

// Per-process cache. The key carries the shop's data_version, which every write to its rows or
// fields bumps (setup lock), so stale entries are never read; old ones age out of the LRU.
// Bounded by entries and by stored characters (a list can hold up to MAX_OPTIONS long values).
const OPTIONS_CACHE_SIZE = 5000;
const OPTIONS_CACHE_CHARS = 20_000_000;
const optionsCache = new Map<string, { values: string[]; chars: number }>();
let cachedChars = 0;

export function clearOptionsCache() {
  optionsCache.clear();
  cachedChars = 0;
}

function cacheOptions(key: string, values: string[]) {
  const chars = values.reduce((n, v) => n + v.length, 0);
  optionsCache.set(key, { values, chars });
  cachedChars += chars;
  while (
    optionsCache.size > OPTIONS_CACHE_SIZE ||
    cachedChars > OPTIONS_CACHE_CHARS
  ) {
    const [oldest, entry] = optionsCache.entries().next().value!;
    optionsCache.delete(oldest);
    cachedChars -= entry.chars;
  }
}

/** Values for field `index` given the picks of the fields before it. */
export async function fieldOptions(
  search: ShopSearch,
  index: number,
  allPicks: Picks,
): Promise<string[]> {
  const field = search.fields[index];
  const picks = picksBefore(allPicks, search.fields, index);
  const key = `${search.shopId}|${search.dataVersion}|${field.id}|${picksKey(picks)}`;
  const hit = optionsCache.get(key);
  if (hit) {
    optionsCache.delete(key);
    optionsCache.set(key, hit);
    return hit.values;
  }
  const values = await queryOptions(search, field, picks);
  // Empty lists (made-up picks) aren't kept, so random requests can't push out real entries.
  if (values.length) cacheOptions(key, values);
  return values;
}

async function queryOptions(
  search: ShopSearch,
  field: { id: string; type: FieldType },
  picks: Picks,
): Promise<string[]> {
  const where = picksWhere(search.fields, picks);
  const rows = await timedRead((tx) =>
    field.type === "year_range"
      ? tx.$queryRaw<{ v: string }[]>`
          SELECT DISTINCT generate_series(r.year_from,
                   GREATEST(r.year_from, coalesce(r.year_to, ${currentYear()}::int)))::text AS v
          FROM (SELECT DISTINCT f.year_from, f.year_to FROM fitment_rows f
                WHERE f.shop_id = ${search.shopId} AND f.year_from IS NOT NULL ${where}) r
          LIMIT ${MAX_OPTIONS}`
      : tx.$queryRaw<{ v: string }[]>`
          SELECT DISTINCT f."values" ->> ${field.id} AS v FROM fitment_rows f
          WHERE f.shop_id = ${search.shopId} AND jsonb_exists(f."values", ${field.id}) ${where}
          LIMIT ${MAX_OPTIONS}`,
  );
  return sortOptions(
    field.type,
    rows.map((r) => r.v),
  );
}

// ---------------------------------------------------------------- fits (product page)

export interface FitRow {
  /** list field id → value */
  v: Record<string, string>;
  /** [year_from, year_to]; null = no years; to null = open range */
  y: [number, number | null] | null;
}

export interface FitsResult {
  state: "ask" | "fits" | "no-fit";
  universal: boolean;
  rows: FitRow[];
  total: number;
}

const linkedAttachments = (
  shopId: string,
  productId: string,
  collectionIds: string[],
) => Prisma.sql`SELECT l.attachment FROM product_links l
  WHERE l.shop_id = ${shopId}
    AND (l.product_id = ${productId} OR l.collection_id = ANY(${collectionIds}::text[]))`;

/**
 * Badge state and table rows for a product (Admin gid) and the collections it's in (gids from
 * Liquid's product.collections; collection links fit every product of the collection).
 */
export async function productFits(
  search: ShopSearch,
  productId: string,
  collectionIds: string[],
  picks: Picks,
): Promise<FitsResult> {
  const { shopId } = search;
  const linked = linkedAttachments(shopId, productId, collectionIds);
  return timedRead(async (tx) => {
    const [rows, [{ total }], universal] = await Promise.all([
      tx.$queryRaw<
        {
          values: Record<string, string>;
          year_from: number | null;
          year_to: number | null;
        }[]
      >`
        SELECT DISTINCT f."values", f.year_from, f.year_to FROM fitment_rows f
        WHERE f.shop_id = ${shopId} AND f.attachment IN (${linked})
        ORDER BY f."values", f.year_from, f.year_to
        LIMIT ${MAX_TABLE_ROWS}`,
      tx.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM (
          SELECT DISTINCT f."values", f.year_from, f.year_to FROM fitment_rows f
          WHERE f.shop_id = ${shopId} AND f.attachment IN (${linked})) d`,
      tx.universalProduct.findUnique({
        where: { shopId_productId: { shopId, productId } },
        select: { productId: true },
      }),
    ]);
    let state: FitsResult["state"] = "ask";
    if (picks.size) {
      if (universal) state = "fits";
      else {
        const [hit] = await tx.$queryRaw<unknown[]>`
          SELECT 1 FROM fitment_rows f
          WHERE f.shop_id = ${shopId} AND f.attachment IN (${linked})
            ${picksWhere(search.fields, picks)}
          LIMIT 1`;
        state = hit ? "fits" : "no-fit";
      }
    }
    return {
      state,
      universal: !!universal,
      total,
      rows: rows.map((r) => ({
        v: r.values,
        y: r.year_from === null ? null : [r.year_from, r.year_to],
      })),
    };
  });
}

// ---------------------------------------------------------------- results

export interface ResultsPage {
  products: { handle: string; universal: boolean }[];
  collections: { handle: string; title: string }[];
  total: number;
  page: number;
  pageCount: number;
}

/** Products that fit the picks (linked rows), then universal products; A–Z by title. */
export async function searchResults(
  search: ShopSearch,
  picks: Picks,
  page: number,
): Promise<ResultsPage> {
  const { shopId } = search;
  const matching = Prisma.sql`SELECT DISTINCT f.attachment FROM fitment_rows f
    WHERE f.shop_id = ${shopId} ${picksWhere(search.fields, picks)}`;
  return timedRead(async (tx) => {
    const [products, collections] = await Promise.all([
      tx.$queryRaw<{ handle: string; universal: boolean; total: number }[]>`
        WITH m AS (${matching}),
        hits AS (
          SELECT l.product_id, false AS universal FROM product_links l
          JOIN m ON m.attachment = l.attachment
          WHERE l.shop_id = ${shopId} AND l.product_id IS NOT NULL
          UNION ALL
          SELECT u.product_id, true FROM universal_products u WHERE u.shop_id = ${shopId}),
        p AS (
          SELECT c.handle, c.title, c.product_id, bool_and(h.universal) AS universal
          FROM hits h JOIN catalog_products c
            ON c.shop_id = ${shopId} AND c.product_id = h.product_id
          WHERE c.status = 'ACTIVE'
          GROUP BY c.handle, c.title, c.product_id)
        SELECT handle, universal, (count(*) OVER ())::int AS total FROM p
        ORDER BY universal, title, product_id
        LIMIT ${RESULTS_PAGE_SIZE} OFFSET ${(page - 1) * RESULTS_PAGE_SIZE}`,
      tx.$queryRaw<{ handle: string; title: string }[]>`
        SELECT DISTINCT c.handle, c.title FROM product_links l
        JOIN (${matching}) m ON m.attachment = l.attachment
        JOIN catalog_collections c ON c.shop_id = l.shop_id AND c.collection_id = l.collection_id
        WHERE l.shop_id = ${shopId}
        ORDER BY c.title LIMIT ${MAX_COLLECTIONS}`,
    ]);
    // Past the last page there is no row to carry the total (0); the route goes back to page 1.
    const total = products[0]?.total ?? 0;
    return {
      products: products.map(({ handle, universal }) => ({
        handle,
        universal,
      })),
      collections,
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / RESULTS_PAGE_SIZE)),
    };
  });
}

// ---------------------------------------------------------------- theme search page

export interface FitSkus {
  /** One SKU per fitting product (the linked variant's, else the product's first), A–Z by title. */
  skus: string[];
  /** Fitting active products, universal ones included. */
  products: number;
  /** Fitting products without any SKU: the theme's search can't find them. */
  withoutSku: number;
}

/**
 * The SKUs to search the theme's search page for (specs/storefront.md › Results): the shopper
 * then sees the theme's own product cards and filters. At most `limit` SKUs are returned; the
 * counts are complete, so the caller knows when the list doesn't fit.
 */
export async function fitSkus(
  search: ShopSearch,
  picks: Picks,
  limit: number,
): Promise<FitSkus> {
  const { shopId } = search;
  const matching = Prisma.sql`SELECT DISTINCT f.attachment FROM fitment_rows f
    WHERE f.shop_id = ${shopId} ${picksWhere(search.fields, picks)}`;
  return timedRead(async (tx) => {
    const rows = await tx.$queryRaw<
      { sku: string | null; products: number; without_sku: number }[]
    >`
      WITH m AS (${matching}),
      hits AS (
        SELECT l.product_id, l.variant_id FROM product_links l
        JOIN m ON m.attachment = l.attachment
        WHERE l.shop_id = ${shopId} AND l.product_id IS NOT NULL
        UNION ALL
        SELECT u.product_id, NULL FROM universal_products u WHERE u.shop_id = ${shopId}),
      p AS (
        SELECT c.product_id, c.title, min(h.variant_id) AS variant_id
        FROM hits h JOIN catalog_products c
          ON c.shop_id = ${shopId} AND c.product_id = h.product_id
        WHERE c.status = 'ACTIVE'
        GROUP BY c.product_id, c.title),
      s AS (
        SELECT p.title, p.product_id, coalesce(
          (SELECT v.sku FROM catalog_variants v WHERE v.shop_id = ${shopId}
             AND v.variant_id = p.variant_id AND v.sku <> ''),
          (SELECT v.sku FROM catalog_variants v WHERE v.shop_id = ${shopId}
             AND v.product_id = p.product_id AND v.sku <> '' ORDER BY v.variant_id LIMIT 1)) AS sku
        FROM p)
      SELECT sku, (count(*) OVER ())::int AS products,
             (count(*) FILTER (WHERE sku IS NULL) OVER ())::int AS without_sku
      FROM s ORDER BY (sku IS NULL), title, product_id
      LIMIT ${limit + 1}`;
    return {
      skus: rows.map((r) => r.sku).filter((s): s is string => !!s),
      products: rows[0]?.products ?? 0,
      withoutSku: rows[0]?.without_sku ?? 0,
    };
  });
}
