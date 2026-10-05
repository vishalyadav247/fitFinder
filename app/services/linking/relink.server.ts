// Matching filter rows to products (specs/product-mapping.md › Data). Rule-based, in SQL against
// the catalog cache, so 700k-row shops link in one pass:
//   - every distinct attachment without a manual link is classified like classifyAttachment()
//     (attachment.ts): product link, collection link, or bare text, which is looked up as a variant
//     SKU first and as a product handle second (case and outer spaces ignored);
//   - several variants with the same SKU: active products first, then the oldest product/variant
//     (first match wins; PROGRESS.md M6 decision);
//   - auto links follow the cache (changed SKU → relinked or unlinked); manual links are never
//     changed by matching, only removed when their product or collection is gone.
// All link writes of a shop take the same advisory lock, so matching runs and manual links can't
// interleave. Request paths pass a short lock timeout instead of waiting behind a long run.
import { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import {
  DELETED,
  lookupKeySql,
  type CatalogProductInput,
} from "./catalog.server";

type Tx = Prisma.TransactionClient;

const STATEMENT_TIMEOUT = "110s";
const TX_OPTIONS = { timeout: 120_000, maxWait: 30_000 };

/** Serializes link writes per shop (transaction-scoped advisory lock). */
export async function lockLinks(tx: Tx, shopId: string) {
  // $executeRaw: the result (void) is never read.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fitfinder-links:${shopId}`}))`;
}

/** A link transaction: statement timeout, optional lock timeout, the shop's link lock. */
export function withLinkLock<T>(
  shopId: string,
  work: (tx: Tx) => Promise<T>,
  { lockTimeout }: { lockTimeout?: string } = {},
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`,
    );
    if (lockTimeout) {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${lockTimeout}'`);
    }
    await lockLinks(tx, shopId);
    return work(tx);
  }, TX_OPTIONS);
}

/** Postgres "lock not available" (lock_timeout), as raised through Prisma. */
export function isLockTimeout(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return /55P03/.test(JSON.stringify(error.meta ?? {}));
  }
  return error instanceof Error && /55P03|lock timeout/i.test(error.message);
}

// Same rules as attachment.ts: /products/{handle} wins over /collections/{handle}.
const PRODUCT_RE = "(?i)/products/([^/?#[:space:]]+)";
const COLLECTION_RE = "(?i)/collections/([^/?#[:space:]]+)";

/** SQL for an attachment's kind ('product' | 'collection' | 'bare') and lookup key. */
export function attachmentKindSql(alias: string) {
  const a = Prisma.raw(`${alias}.attachment`);
  return {
    kind: Prisma.sql`CASE
      WHEN substring(${a} from ${PRODUCT_RE}) IS NOT NULL THEN 'product'
      WHEN substring(${a} from ${COLLECTION_RE}) IS NOT NULL THEN 'collection'
      ELSE 'bare' END`,
    key: Prisma.sql`coalesce(
      lower(substring(${a} from ${PRODUCT_RE})),
      lower(substring(${a} from ${COLLECTION_RE})),
      ${lookupKeySql(a)})`,
  };
}

export interface RelinkOptions {
  /** Only these attachments (webhooks, a saved row); all of the shop's when omitted. */
  attachments?: string[];
  /** After a full catalog sync: drop links (also manual) and universal products whose product
   *  or collection no longer exists. */
  pruneMissing?: boolean;
  /** Give up after this long waiting for another link run (request paths), e.g. "3s". */
  lockTimeout?: string;
}

/** Re-runs matching; returns how many attachments got a link they didn't have. */
export function relink(
  shopId: string,
  { lockTimeout, ...options }: RelinkOptions = {},
): Promise<number> {
  return withLinkLock(shopId, (tx) => relinkTx(tx, shopId, options), {
    lockTimeout,
  });
}

export async function relinkTx(
  tx: Tx,
  shopId: string,
  { attachments, pruneMissing = false }: RelinkOptions,
): Promise<number> {
  if (attachments && attachments.length === 0) return 0;
  const inScope = (col: string) =>
    attachments
      ? Prisma.sql`AND ${Prisma.raw(col)} = ANY(${attachments}::text[])`
      : Prisma.empty;

  if (pruneMissing) {
    await tx.$executeRaw`
      DELETE FROM product_links l
      WHERE l.shop_id = ${shopId} AND (
        (l.collection_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM catalog_collections c
          WHERE c.shop_id = l.shop_id AND c.collection_id = l.collection_id))
        OR (l.product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM catalog_products p
          WHERE p.shop_id = l.shop_id AND p.product_id = l.product_id AND p.status <> ${DELETED})))`;
    await tx.$executeRaw`
      UPDATE product_links l SET variant_id = NULL, updated_at = now()
      WHERE l.shop_id = ${shopId} AND l.method = 'manual' AND l.variant_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM catalog_variants v
          WHERE v.shop_id = l.shop_id AND v.variant_id = l.variant_id AND v.product_id = l.product_id)`;
    await tx.$executeRaw`
      DELETE FROM universal_products u
      WHERE u.shop_id = ${shopId} AND NOT EXISTS (SELECT 1 FROM catalog_products p
        WHERE p.shop_id = u.shop_id AND p.product_id = u.product_id AND p.status <> ${DELETED})`;
  }

  // What each attachment without a manual link should point at now.
  await tx.$executeRawUnsafe(`CREATE TEMP TABLE IF NOT EXISTS link_targets (
      attachment text PRIMARY KEY, kind text NOT NULL, product_id text,
      variant_id text, collection_id text) ON COMMIT DROP`);
  await tx.$executeRawUnsafe(`TRUNCATE link_targets`);
  const k = attachmentKindSql("a");
  await tx.$executeRaw`
    INSERT INTO link_targets (attachment, kind, product_id, variant_id, collection_id)
    SELECT k.attachment,
           CASE WHEN v.variant_id IS NOT NULL THEN 'sku'
                WHEN k.kind = 'bare' THEN 'product' ELSE k.kind END,
           coalesce(v.product_id, p.product_id), v.variant_id, c.collection_id
    FROM (
      SELECT a.attachment, ${k.kind} AS kind, ${k.key} AS key
      FROM (SELECT DISTINCT f.attachment FROM fitment_rows f
            WHERE f.shop_id = ${shopId} ${inScope("f.attachment")}) a
      WHERE NOT EXISTS (SELECT 1 FROM product_links l
        WHERE l.shop_id = ${shopId} AND l.attachment = a.attachment AND l.method = 'manual')
    ) k
    LEFT JOIN LATERAL (
      SELECT cv.variant_id, cv.product_id
      FROM catalog_variants cv
      JOIN catalog_products cp ON cp.shop_id = cv.shop_id AND cp.product_id = cv.product_id
      WHERE k.kind = 'bare' AND k.key <> '' AND cv.shop_id = ${shopId} AND cv.sku_key = k.key
        AND cp.status <> ${DELETED}
      ORDER BY (cp.status <> 'ACTIVE'), length(cv.product_id), cv.product_id,
               length(cv.variant_id), cv.variant_id
      LIMIT 1) v ON true
    LEFT JOIN LATERAL (
      SELECT cp.product_id FROM catalog_products cp
      WHERE (k.kind = 'product' OR (k.kind = 'bare' AND v.variant_id IS NULL))
        AND cp.shop_id = ${shopId} AND cp.handle = k.key AND cp.status <> ${DELETED}
      ORDER BY length(cp.product_id), cp.product_id
      LIMIT 1) p ON true
    LEFT JOIN LATERAL (
      SELECT cc.collection_id FROM catalog_collections cc
      WHERE k.kind = 'collection' AND cc.shop_id = ${shopId} AND cc.handle = k.key
      ORDER BY length(cc.collection_id), cc.collection_id
      LIMIT 1) c ON true
    WHERE v.variant_id IS NOT NULL OR p.product_id IS NOT NULL OR c.collection_id IS NOT NULL`;
  // Fresh statistics for the joins below (the temp table can hold tens of thousands of rows).
  await tx.$executeRawUnsafe(`ANALYZE link_targets`);

  // Auto links that no longer match (or whose rows are gone) are removed.
  await tx.$executeRaw`
    DELETE FROM product_links l
    WHERE l.shop_id = ${shopId} AND l.method = 'auto' ${inScope("l.attachment")}
      AND NOT EXISTS (SELECT 1 FROM link_targets t WHERE t.attachment = l.attachment)`;

  const [{ added }] = await tx.$queryRaw<{ added: number }[]>`
    WITH up AS (
      INSERT INTO product_links
        (id, shop_id, attachment, kind, product_id, variant_id, collection_id, method, updated_at)
      SELECT gen_random_uuid()::text, ${shopId}, t.attachment, t.kind::"LinkKind",
             t.product_id, t.variant_id, t.collection_id, 'auto'::"LinkMethod", now()
      FROM link_targets t
      ON CONFLICT (shop_id, attachment) DO UPDATE SET
        kind = EXCLUDED.kind, product_id = EXCLUDED.product_id, variant_id = EXCLUDED.variant_id,
        collection_id = EXCLUDED.collection_id, updated_at = now()
      WHERE product_links.method = 'auto'
        AND (product_links.kind, product_links.product_id, product_links.variant_id,
             product_links.collection_id)
          IS DISTINCT FROM (EXCLUDED.kind, EXCLUDED.product_id, EXCLUDED.variant_id,
                            EXCLUDED.collection_id)
      RETURNING (xmax = 0) AS inserted)
    SELECT count(*) FILTER (WHERE inserted)::int AS added FROM up`;
  return added;
}

/**
 * Attachments a product change can affect without a full scan: those linked to the product now,
 * and those written exactly like one of its SKUs (as is, upper or lower case) or its handle. Other
 * spellings and product URLs are picked up by the next import or Check links again.
 */
export async function attachmentsForProduct(
  tx: Tx,
  shopId: string,
  productId: string,
  product: CatalogProductInput | null,
): Promise<string[]> {
  const candidates = new Set<string>();
  for (const v of product?.variants ?? []) {
    const sku = v.sku.trim();
    if (!sku) continue;
    candidates.add(sku);
    candidates.add(sku.toLowerCase());
    candidates.add(sku.toUpperCase());
  }
  if (product?.handle) candidates.add(product.handle);
  const rows = await tx.$queryRaw<{ attachment: string }[]>`
    SELECT attachment FROM product_links WHERE shop_id = ${shopId} AND product_id = ${productId}
    UNION
    SELECT DISTINCT attachment FROM fitment_rows
    WHERE shop_id = ${shopId} AND attachment = ANY(${[...candidates]}::text[])`;
  return rows.map((r) => r.attachment);
}

/** A deleted product: its links and universal entry go, its rows may match another product. */
export function removeProduct(
  shopId: string,
  productId: string,
  { lockTimeout }: { lockTimeout?: string } = {},
) {
  return withLinkLock(
    shopId,
    async (tx) => {
      const affected = await attachmentsForProduct(tx, shopId, productId, null);
      await tx.$executeRaw`
      DELETE FROM product_links WHERE shop_id = ${shopId} AND product_id = ${productId}`;
      await tx.$executeRaw`
      DELETE FROM universal_products WHERE shop_id = ${shopId} AND product_id = ${productId}`;
      await tx.$executeRaw`
      DELETE FROM catalog_variants WHERE shop_id = ${shopId} AND product_id = ${productId}`;
      // A marker instead of a delete, so an export that started earlier can't bring it back.
      await tx.$executeRaw`
      INSERT INTO catalog_products (shop_id, product_id, title, handle, status, updated_at)
      VALUES (${shopId}, ${productId}, '', '', ${DELETED}, now())
      ON CONFLICT (shop_id, product_id) DO UPDATE SET status = ${DELETED}, updated_at = now()`;
      return relinkTx(tx, shopId, { attachments: affected });
    },
    { lockTimeout },
  );
}

/** A created or changed product (cache already updated): relink what it can affect. */
export function relinkProduct(
  shopId: string,
  product: CatalogProductInput,
  { lockTimeout }: { lockTimeout?: string } = {},
) {
  return withLinkLock(
    shopId,
    async (tx) => {
      const affected = await attachmentsForProduct(
        tx,
        shopId,
        product.productId,
        product,
      );
      return relinkTx(tx, shopId, { attachments: affected });
    },
    { lockTimeout },
  );
}
