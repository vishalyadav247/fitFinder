// The shop's product catalog cache (catalog_products / catalog_variants / catalog_collections):
// loaded from Shopify with a bulk operation (products + variants) and a paged query
// (collections), kept fresh by products/* webhooks and by the resource picker. Every write is
// scoped by shop. Operations checked against Admin GraphQL 2026-10 (PROGRESS.md › Verified).
import { Prisma } from "@prisma/client";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { z } from "zod";
import prisma from "../../db.server";
import { gidType, lookupKey } from "./attachment";

/** `admin.graphql` of @shopify/shopify-app-react-router (or a test double). */
export type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<{ json(): Promise<unknown> }>;

export interface CatalogProductInput {
  productId: string;
  title: string;
  handle: string;
  status: string;
  variants: { variantId: string; sku: string }[];
}

export interface CatalogCollectionInput {
  collectionId: string;
  handle: string;
  title: string;
}

export class ShopifyApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyApiError";
  }
}

const INSERT_BATCH = 5000;
const POLL_MS = 3000;
// A bulk export of a very large catalog can take a while; give up after this long.
const BULK_TIMEOUT_MS = 45 * 60_000;

export const skuKey = lookupKey;

/** lower(trim) in SQL with the same characters as lookupKey (attachment.ts). */
export const lookupKeySql = (expr: Prisma.Sql) =>
  Prisma.sql`lower(btrim(${expr}, E' \t\r\n' || chr(160)))`;

const THROTTLE_RETRIES = 4;
const isThrottled = (e: unknown) => /THROTTLED/.test(JSON.stringify(e ?? ""));

/**
 * Runs an Admin GraphQL operation and returns its data. Throttled calls are retried with
 * backoff (1, 2, 4, 8 s); other errors throw. The library may throw on GraphQL errors or return
 * them in the body; both are handled.
 */
export async function gqlData<T>(
  gql: AdminGraphql,
  query: string,
  variables?: Record<string, unknown>,
  { backoffMs = 1000 } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let errors: unknown;
    try {
      const res = await gql(query, variables ? { variables } : undefined);
      const body = (await res.json()) as { data?: T; errors?: unknown };
      if (!body.errors && body.data) return body.data;
      errors = body.errors ?? "no data";
    } catch (error) {
      if (
        !isThrottled(error) &&
        !isThrottled((error as { body?: unknown })?.body)
      ) {
        throw error;
      }
      errors = "THROTTLED";
    }
    if (!isThrottled(errors) || attempt >= THROTTLE_RETRIES) {
      throw new ShopifyApiError(
        `Admin API error: ${JSON.stringify(errors).slice(0, 500)}`,
      );
    }
    await new Promise((r) => setTimeout(r, backoffMs * 2 ** attempt));
  }
}

// ---------------------------------------------------------------- bulk export (products)

// Inner query of the bulk operation: every product with its variants (JSONL: one line per node,
// variants carry __parentId).
export const BULK_PRODUCTS_QUERY = `{
  products {
    edges { node { id title handle status variants { edges { node { id sku } } } } }
  }
}`;

const BULK_RUN = `#graphql
  mutation CatalogBulkExport($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message code }
    }
  }`;

const BULK_CANCEL = `#graphql
  mutation CancelBulk($id: ID!) {
    bulkOperationCancel(id: $id) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }`;

/** Cancels an export we gave up on, so it doesn't keep counting against the shop's limit. */
export async function cancelBulk(gql: AdminGraphql, id: string) {
  try {
    await gqlData(gql, BULK_CANCEL, { id });
  } catch (error) {
    console.warn("bulk export cancel failed", { id, error });
  }
}

const BULK_STATUS = `#graphql
  query BulkStatus($id: ID!) {
    bulkOperation(id: $id) { id status errorCode objectCount url partialDataUrl }
  }`;

/** Starts the products export; returns the bulk operation id. */
export async function startBulkExport(gql: AdminGraphql): Promise<string> {
  const data = await gqlData<{
    bulkOperationRunQuery: {
      bulkOperation: { id: string } | null;
      userErrors: { message: string }[];
    };
  }>(gql, BULK_RUN, { query: BULK_PRODUCTS_QUERY });
  const { bulkOperation, userErrors } = data.bulkOperationRunQuery;
  if (!bulkOperation) {
    throw new ShopifyApiError(
      `Bulk export refused: ${userErrors.map((e) => e.message).join("; ")}`,
    );
  }
  return bulkOperation.id;
}

/**
 * Waits for the bulk operation; returns its JSONL url (null when the store has no products).
 * `gqlFor` is asked for a client on every poll, so a long export survives a token refresh.
 * `onPoll` lets the caller heartbeat.
 */
export async function waitForBulk(
  gqlFor: () => Promise<AdminGraphql>,
  id: string,
  onPoll: () => Promise<void> = async () => {},
  { pollMs = POLL_MS, timeoutMs = BULK_TIMEOUT_MS } = {},
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const data = await gqlData<{
      bulkOperation: {
        status: string;
        errorCode: string | null;
        url: string | null;
      } | null;
    }>(await gqlFor(), BULK_STATUS, { id });
    const op = data.bulkOperation;
    if (!op) throw new ShopifyApiError("The bulk export disappeared.");
    if (op.status === "COMPLETED") return op.url;
    if (op.status !== "CREATED" && op.status !== "RUNNING") {
      throw new ShopifyApiError(
        `Bulk export ${op.status.toLowerCase()}${op.errorCode ? ` (${op.errorCode})` : ""}`,
      );
    }
    if (Date.now() > deadline) {
      await cancelBulk(await gqlFor(), id);
      throw new ShopifyApiError("The bulk export took too long.");
    }
    await onPoll();
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

const bulkLineSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  handle: z.string().optional(),
  status: z.string().optional(),
  sku: z.string().nullable().optional(),
  __parentId: z.string().optional(),
});

/**
 * Builds the catalog from JSONL lines (products first, then their variants with __parentId; the
 * order isn't relied on). Lines that aren't products or variants are ignored.
 */
export async function collectBulkLines(
  lines: AsyncIterable<string> | Iterable<string>,
): Promise<CatalogProductInput[]> {
  const products = new Map<string, CatalogProductInput>();
  const orphans: { parent: string; variantId: string; sku: string }[] = [];
  for await (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const parsed = bulkLineSchema.safeParse(JSON.parse(line));
    if (!parsed.success) continue;
    const n = parsed.data;
    if (n.id.startsWith("gid://shopify/Product/") && !n.__parentId) {
      const existing = products.get(n.id);
      products.set(n.id, {
        productId: n.id,
        title: n.title ?? "",
        handle: (n.handle ?? "").toLowerCase(),
        status: (n.status ?? "ACTIVE").toUpperCase(),
        variants: existing?.variants ?? [],
      });
    } else if (
      n.id.startsWith("gid://shopify/ProductVariant/") &&
      n.__parentId
    ) {
      const variant = { variantId: n.id, sku: n.sku ?? "" };
      const parent = products.get(n.__parentId);
      if (parent) parent.variants.push(variant);
      else orphans.push({ parent: n.__parentId, ...variant });
    }
  }
  for (const o of orphans) {
    products
      .get(o.parent)
      ?.variants.push({ variantId: o.variantId, sku: o.sku });
  }
  return [...products.values()];
}

/** Streams the JSONL file of a finished bulk operation. */
export async function* fetchJsonlLines(url: string): AsyncGenerator<string> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new ShopifyApiError(`Bulk export download failed (${res.status}).`);
  }
  const lines = createInterface({
    input: Readable.fromWeb(res.body as unknown as WebReadableStream),
    crlfDelay: Infinity,
  });
  for await (const line of lines) yield line;
}

// ---------------------------------------------------------------- collections, single products

const COLLECTIONS = `#graphql
  query CatalogCollections($after: String) {
    collections(first: 250, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id handle title }
    }
  }`;

export async function fetchCollections(
  gql: AdminGraphql,
): Promise<CatalogCollectionInput[]> {
  const all: CatalogCollectionInput[] = [];
  let after: string | null = null;
  for (;;) {
    const data: {
      collections: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: { id: string; handle: string; title: string }[];
      };
    } = await gqlData(gql, COLLECTIONS, { after });
    for (const c of data.collections.nodes) {
      all.push({
        collectionId: c.id,
        handle: c.handle.toLowerCase(),
        title: c.title,
      });
    }
    if (!data.collections.pageInfo.hasNextPage) return all;
    after = data.collections.pageInfo.endCursor;
  }
}

const PRODUCT_VARIANTS = `#graphql
  query ProductVariantsPage($id: ID!, $after: String) {
    product(id: $id) {
      id title handle status
      variants(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { id sku } }
    }
  }`;

/** One product with all its variants; null when it doesn't exist (any more). */
export async function fetchProduct(
  gql: AdminGraphql,
  productId: string,
): Promise<CatalogProductInput | null> {
  let result: CatalogProductInput | null = null;
  let after: string | null = null;
  for (;;) {
    const data: {
      product: {
        id: string;
        title: string;
        handle: string;
        status: string;
        variants: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: { id: string; sku: string | null }[];
        };
      } | null;
    } = await gqlData(gql, PRODUCT_VARIANTS, { id: productId, after });
    const p = data.product;
    if (!p) return result;
    result ??= {
      productId: p.id,
      title: p.title,
      handle: p.handle.toLowerCase(),
      status: p.status.toUpperCase(),
      variants: [],
    };
    for (const v of p.variants.nodes) {
      result.variants.push({ variantId: v.id, sku: v.sku ?? "" });
    }
    if (!p.variants.pageInfo.hasNextPage) return result;
    after = p.variants.pageInfo.endCursor;
  }
}

const PICKED = `#graphql
  query PickedResources($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product { id title handle status variants(first: 1) { nodes { id sku } } }
      ... on Collection { id handle title }
    }
  }`;

export interface PickedResources {
  products: CatalogProductInput[];
  collections: CatalogCollectionInput[];
}

// Requested cost grows with every id; 50 per call stays far below the 1,000-point query limit.
const PICK_BATCH = 50;

/**
 * Products and collections by id, read from Shopify (never trust ids or titles from the browser).
 * Unknown ids are left out. Products carry only their first variant (merge it, don't replace).
 */
export async function fetchResources(
  gql: AdminGraphql,
  ids: string[],
): Promise<PickedResources> {
  const out: PickedResources = { products: [], collections: [] };
  for (let i = 0; i < ids.length; i += PICK_BATCH) {
    await fetchResourceBatch(gql, ids.slice(i, i + PICK_BATCH), out);
  }
  return out;
}

async function fetchResourceBatch(
  gql: AdminGraphql,
  ids: string[],
  out: PickedResources,
) {
  const data = await gqlData<{
    nodes: ({
      id?: string;
      title?: string;
      handle?: string;
      status?: string;
      variants?: { nodes: { id: string; sku: string | null }[] };
    } | null)[];
  }>(gql, PICKED, { ids });
  for (const n of data.nodes) {
    if (!n?.id || n.handle === undefined) continue;
    if (n.id.startsWith("gid://shopify/Product/")) {
      out.products.push({
        productId: n.id,
        title: n.title ?? "",
        handle: n.handle.toLowerCase(),
        status: (n.status ?? "ACTIVE").toUpperCase(),
        variants: (n.variants?.nodes ?? []).map((v) => ({
          variantId: v.id,
          sku: v.sku ?? "",
        })),
      });
    } else if (n.id.startsWith("gid://shopify/Collection/")) {
      out.collections.push({
        collectionId: n.id,
        handle: n.handle.toLowerCase(),
        title: n.title ?? "",
      });
    }
  }
}

// ---------------------------------------------------------------- products/* webhook payloads
// The webhook only queues the product (jobs.server.ts); the job reads it again from the Admin API,
// so late, duplicate or out-of-order deliveries and cut-off variant lists can't leave stale data.

/** products/create|update payload → product gid. */
export function productIdFromWebhook(payload: unknown): string | null {
  const parsed = z
    .object({
      admin_graphql_api_id: z
        .string()
        .refine((id) => gidType(id) === "Product"),
    })
    .safeParse(payload);
  return parsed.success ? parsed.data.admin_graphql_api_id : null;
}

/**
 * products/delete payload (`{"id": 123}`) → product gid. Read from the raw body: ids can be larger
 * than JavaScript's safe integers, so a parsed number may be off.
 */
export function deletedProductId(rawBody: string): string | null {
  const m = rawBody.match(/"id"\s*:\s*"?(\d{1,20})"?/);
  return m ? `gid://shopify/Product/${m[1]}` : null;
}

// ---------------------------------------------------------------- cache writes

type Tx = Prisma.TransactionClient;

async function insertProducts(
  tx: Tx,
  shopId: string,
  products: CatalogProductInput[],
) {
  for (let i = 0; i < products.length; i += INSERT_BATCH) {
    const b = products.slice(i, i + INSERT_BATCH);
    await tx.$executeRaw`
      INSERT INTO catalog_products (shop_id, product_id, title, handle, status, updated_at)
      SELECT ${shopId}, p.id, p.title, p.handle, p.status, now()
      FROM unnest(${b.map((p) => p.productId)}::text[], ${b.map((p) => p.title)}::text[],
                  ${b.map((p) => p.handle)}::text[], ${b.map((p) => p.status)}::text[])
        AS p(id, title, handle, status)
      ON CONFLICT (shop_id, product_id) DO UPDATE SET
        title = EXCLUDED.title, handle = EXCLUDED.handle, status = EXCLUDED.status,
        updated_at = now()`;
  }
}

async function insertVariants(
  tx: Tx,
  shopId: string,
  products: CatalogProductInput[],
) {
  const rows = products.flatMap((p) =>
    p.variants.map((v) => ({ ...v, productId: p.productId })),
  );
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const b = rows.slice(i, i + INSERT_BATCH);
    await tx.$executeRaw`
      INSERT INTO catalog_variants (shop_id, variant_id, product_id, sku, sku_key)
      SELECT ${shopId}, v.id, v.product_id, v.sku, ${lookupKeySql(Prisma.sql`v.sku`)}
      FROM unnest(${b.map((v) => v.variantId)}::text[], ${b.map((v) => v.productId)}::text[],
                  ${b.map((v) => v.sku)}::text[]) AS v(id, product_id, sku)
      ON CONFLICT (shop_id, variant_id) DO UPDATE SET
        product_id = EXCLUDED.product_id, sku = EXCLUDED.sku, sku_key = EXCLUDED.sku_key`;
  }
}

/** Replaces the whole cache with a fresh export, in one transaction. */
/** Status of a product deleted in Shopify (products/delete), kept so an older export can't
 *  bring it back. Treated as absent everywhere; cleared by the next full sync. */
export const DELETED = "DELETED";

/** Database time, to compare with catalog updated_at values (no app/DB clock skew). */
export async function dbNow(): Promise<Date> {
  const [{ now }] = await prisma.$queryRaw<
    { now: Date }[]
  >`SELECT now() AS now`;
  return now;
}

/**
 * Replaces the cache with a fresh export, in one transaction. `exportStartedAt` (database time,
 * taken before the export started): products the webhook job wrote or deleted after that are
 * newer than the export and are kept as they are.
 */
export async function replaceCatalog(
  shopId: string,
  products: CatalogProductInput[],
  collections: CatalogCollectionInput[],
  exportStartedAt: Date,
) {
  await prisma.$transaction(
    async (tx) => {
      const newer = new Set(
        (
          await tx.$queryRaw<{ product_id: string }[]>`
            SELECT product_id FROM catalog_products
            WHERE shop_id = ${shopId} AND updated_at > ${exportStartedAt}`
        ).map((r) => r.product_id),
      );
      await tx.$executeRaw`
        DELETE FROM catalog_variants v WHERE v.shop_id = ${shopId} AND NOT EXISTS (
          SELECT 1 FROM catalog_products p WHERE p.shop_id = v.shop_id
            AND p.product_id = v.product_id AND p.updated_at > ${exportStartedAt})`;
      await tx.$executeRaw`
        DELETE FROM catalog_products
        WHERE shop_id = ${shopId} AND updated_at <= ${exportStartedAt}`;
      await tx.$executeRaw`DELETE FROM catalog_collections WHERE shop_id = ${shopId}`;
      const fresh = products.filter((p) => !newer.has(p.productId));
      await insertProducts(tx, shopId, fresh);
      await insertVariants(tx, shopId, fresh);
      for (let i = 0; i < collections.length; i += INSERT_BATCH) {
        const b = collections.slice(i, i + INSERT_BATCH);
        await tx.$executeRaw`
          INSERT INTO catalog_collections (shop_id, collection_id, handle, title)
          SELECT ${shopId}, c.id, c.handle, c.title
          FROM unnest(${b.map((c) => c.collectionId)}::text[], ${b.map((c) => c.handle)}::text[],
                      ${b.map((c) => c.title)}::text[]) AS c(id, handle, title)
          ON CONFLICT (shop_id, collection_id) DO NOTHING`;
      }
    },
    { timeout: 10 * 60_000, maxWait: 30_000 },
  );
  // Fresh statistics: the lists and matching join these tables right after a reload.
  await prisma.$executeRawUnsafe(
    "ANALYZE catalog_products, catalog_variants, catalog_collections",
  );
}

/**
 * Upserts products. `replaceVariants`: the product's variant list is complete (webhook, full
 * fetch), so variants not in it are removed; otherwise variants are only added or updated.
 */
export async function upsertProducts(
  shopId: string,
  products: CatalogProductInput[],
  { replaceVariants }: { replaceVariants: boolean },
) {
  if (products.length === 0) return;
  await prisma.$transaction(async (tx) => {
    await insertProducts(tx, shopId, products);
    if (replaceVariants) {
      await tx.$executeRaw`
        DELETE FROM catalog_variants
        WHERE shop_id = ${shopId} AND product_id = ANY(${products.map((p) => p.productId)}::text[])`;
    }
    await insertVariants(tx, shopId, products);
  });
}

export async function upsertCollections(
  shopId: string,
  collections: CatalogCollectionInput[],
) {
  for (const c of collections) {
    await prisma.$executeRaw`
      INSERT INTO catalog_collections (shop_id, collection_id, handle, title)
      VALUES (${shopId}, ${c.collectionId}, ${c.handle}, ${c.title})
      ON CONFLICT (shop_id, collection_id) DO UPDATE SET handle = EXCLUDED.handle, title = EXCLUDED.title`;
  }
}
