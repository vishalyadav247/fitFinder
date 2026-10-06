// Product mapping (specs/product-mapping.md): unlinked rows grouped by attachment, store products
// without filter data, universal products, and the merchant's manual links. Every query is scoped
// by shop; link writes take the shop's link lock (relink.server.ts lockLinks).
import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../db.server";
import { MAX_ATTACHMENT_LENGTH } from "../services/import/transform";
import {
  MAX_PICK,
  classifyAttachment,
  gidType,
  type AttachmentKind,
} from "../services/linking/attachment";
import { isLockTimeout, withLinkLock } from "../services/linking/relink.server";
import {
  linkedProductsSql,
  overLimitMessage,
} from "../services/billing.server";

type Tx = Prisma.TransactionClient;

export const MAPPING_PAGE_SIZE = 50;
const READ_TIMEOUT = "15s";

/** A problem the merchant can act on; shown as an error toast. */
export class LinkRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkRuleError";
  }
}

const gid = (type: "Product" | "ProductVariant" | "Collection") =>
  z.string().refine((id) => gidType(id) === type, "Unknown id");

const productIds = z
  .string()
  .transform((s, ctx) => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "ids" });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(gid("Product"))
      .min(1)
      .max(MAX_PICK)
      .transform((ids) => [...new Set(ids)]),
  );

/** Product mapping page actions (app.product-mapping.tsx). */
export const mappingIntentSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("check") }),
  z.object({
    intent: z.literal("link"),
    attachment: z.string().min(1).max(MAX_ATTACHMENT_LENGTH),
    resourceId: z
      .string()
      .refine(
        (id) => gidType(id) === "Product" || gidType(id) === "Collection",
        "Unknown id",
      ),
    variantId: gid("ProductVariant").optional(),
  }),
  z.object({ intent: z.literal("universal-add"), ids: productIds }),
  z.object({ intent: z.literal("universal-mark"), productId: gid("Product") }),
  z.object({
    intent: z.literal("universal-remove"),
    productId: gid("Product"),
  }),
]);

async function timedRead<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL statement_timeout = '${READ_TIMEOUT}'`,
      );
      return work(tx);
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

// ---------------------------------------------------------------- unlinked rows

export interface UnlinkedGroup {
  attachment: string;
  kind: AttachmentKind;
  rows: number;
  /** The group's oldest row, for the Fits column. */
  first: {
    values: Record<string, string>;
    yearFrom: number | null;
    yearTo: number | null;
  };
}

export interface Paged<T> {
  items: T[];
  page: number;
  hasNextPage: boolean;
}

/** Attachments without a link, most rows first (one line per attachment). */
export async function unlinkedGroups(
  shopId: string,
  page: number,
): Promise<Paged<UnlinkedGroup>> {
  const groups = await timedRead(
    (tx) => tx.$queryRaw<
      {
        attachment: string;
        n: number;
        values: Record<string, string>;
        year_from: number | null;
        year_to: number | null;
      }[]
    >`
      SELECT g.attachment, g.n, f."values", f.year_from, f.year_to
      FROM (
        SELECT f.attachment, count(*)::int AS n, min(f.id) AS first_id
        FROM fitment_rows f
        LEFT JOIN product_links p ON p.shop_id = f.shop_id AND p.attachment = f.attachment
        WHERE f.shop_id = ${shopId} AND p.attachment IS NULL
        GROUP BY f.attachment
        ORDER BY count(*) DESC, f.attachment
        LIMIT ${MAPPING_PAGE_SIZE + 1} OFFSET ${(page - 1) * MAPPING_PAGE_SIZE}
      ) g
      JOIN fitment_rows f ON f.id = g.first_id AND f.shop_id = ${shopId}
      ORDER BY g.n DESC, g.attachment`,
  );
  return {
    items: groups.slice(0, MAPPING_PAGE_SIZE).map((g) => ({
      attachment: g.attachment,
      kind: classifyAttachment(g.attachment).kind,
      rows: g.n,
      first: { values: g.values, yearFrom: g.year_from, yearTo: g.year_to },
    })),
    page,
    hasNextPage: groups.length > MAPPING_PAGE_SIZE,
  };
}

// ---------------------------------------------------------------- products

export interface CatalogItem {
  productId: string;
  title: string;
  handle: string;
  /** First non-empty variant SKU, "" when none. */
  sku: string;
}

const firstSku = Prisma.sql`coalesce((SELECT v.sku FROM catalog_variants v
  WHERE v.shop_id = p.shop_id AND v.product_id = p.product_id AND btrim(v.sku) <> ''
  ORDER BY length(v.variant_id), v.variant_id LIMIT 1), '')`;

/**
 * Active store products that no filter row reaches (no link with rows behind it points to them)
 * and that aren't universal. Manual links outlive their rows, hence the row check. Products only
 * reachable through a collection link are listed too (collection membership isn't cached).
 */
const withoutDataWhere = (shopId: string) => Prisma.sql`
  p.shop_id = ${shopId} AND p.status = 'ACTIVE'
  AND NOT EXISTS (SELECT 1 FROM product_links l
    WHERE l.shop_id = p.shop_id AND l.product_id = p.product_id
      AND EXISTS (SELECT 1 FROM fitment_rows f
        WHERE f.shop_id = l.shop_id AND f.attachment = l.attachment))
  AND NOT EXISTS (SELECT 1 FROM universal_products u
    WHERE u.shop_id = p.shop_id AND u.product_id = p.product_id)`;

export async function productsWithoutData(
  shopId: string,
  page: number,
): Promise<Paged<CatalogItem> & { total: number }> {
  return timedRead(async (tx) => {
    const [items, [{ total }]] = await Promise.all([
      tx.$queryRaw<CatalogItem[]>`
        SELECT p.product_id AS "productId", p.title, p.handle, ${firstSku} AS sku
        FROM catalog_products p
        WHERE ${withoutDataWhere(shopId)}
        ORDER BY p.title, p.product_id
        LIMIT ${MAPPING_PAGE_SIZE + 1} OFFSET ${(page - 1) * MAPPING_PAGE_SIZE}`,
      tx.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM catalog_products p
        WHERE ${withoutDataWhere(shopId)}`,
    ]);
    return {
      items: items.slice(0, MAPPING_PAGE_SIZE),
      page,
      hasNextPage: items.length > MAPPING_PAGE_SIZE,
      total,
    };
  });
}

/** How many products "Products without filter data" lists (Dashboard). */
export async function productsWithoutDataCount(shopId: string) {
  return timedRead(async (tx) => {
    const [{ total }] = await tx.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS total FROM catalog_products p
      WHERE ${withoutDataWhere(shopId)}`;
    return total;
  });
}

export async function universalProducts(
  shopId: string,
  page: number,
): Promise<Paged<CatalogItem> & { total: number }> {
  const [items, total] = await Promise.all([
    prisma.$queryRaw<CatalogItem[]>`
      SELECT u.product_id AS "productId", coalesce(p.title, '') AS title,
             coalesce(p.handle, '') AS handle,
             CASE WHEN p.product_id IS NULL THEN '' ELSE ${firstSku} END AS sku
      FROM universal_products u
      LEFT JOIN catalog_products p ON p.shop_id = u.shop_id AND p.product_id = u.product_id
      WHERE u.shop_id = ${shopId}
      ORDER BY u.created_at DESC, u.product_id
      LIMIT ${MAPPING_PAGE_SIZE + 1} OFFSET ${(page - 1) * MAPPING_PAGE_SIZE}`,
    prisma.universalProduct.count({ where: { shopId } }),
  ]);
  return {
    items: items.slice(0, MAPPING_PAGE_SIZE),
    page,
    hasNextPage: items.length > MAPPING_PAGE_SIZE,
    total,
  };
}

export async function productTitle(shopId: string, productId: string) {
  const p = await prisma.catalogProduct.findUnique({
    where: { shopId_productId: { shopId, productId } },
    select: { title: true },
  });
  return p?.title || "The product";
}

// ---------------------------------------------------------------- writes

export type ManualTarget =
  | { type: "product"; productId: string; variantId: string | null }
  | { type: "collection"; collectionId: string };

/**
 * Links every row with this attachment to the chosen product or collection (Choose product).
 * The target must already be checked against Shopify and stored in the catalog cache.
 */
export async function linkManually(
  shopId: string,
  attachment: string,
  target: ManualTarget,
) {
  try {
    await withLinkLock(
      shopId,
      (tx) => saveManualLink(tx, shopId, attachment, target),
      {
        lockTimeout: "5s",
      },
    );
  } catch (error) {
    if (isLockTimeout(error)) {
      throw new LinkRuleError(
        "Links are being checked right now. Try again in a moment.",
      );
    }
    throw error;
  }
}

async function saveManualLink(
  tx: Tx,
  shopId: string,
  attachment: string,
  target: ManualTarget,
) {
  const used = await tx.fitmentRow.findFirst({
    where: { shopId, attachment },
    select: { id: true },
  });
  if (!used) {
    throw new LinkRuleError(
      "No filter rows use this attachment any more. Refresh the page.",
    );
  }
  const classified = classifyAttachment(attachment).kind;
  const kind: AttachmentKind =
    target.type === "collection"
      ? "collection"
      : classified === "collection"
        ? "product"
        : classified;
  if (target.type === "product") {
    // Only a product that isn't linked or universal yet adds to the plan's linked products; a
    // shop already over its limit can still relink to products it has.
    const over = await overLimitMessage(
      shopId,
      "products",
      async () => {
        const [{ known, n }] = await tx.$queryRaw<
          { known: boolean; n: number }[]
        >`
          WITH linked AS (${linkedProductsSql(shopId, attachment)})
          SELECT EXISTS (SELECT 1 FROM linked WHERE product_id = ${target.productId}) AS known,
                 (SELECT count(*) FROM linked)::int AS n`;
        return known ? 0 : n + 1;
      },
      tx,
    );
    if (over) throw new LinkRuleError(over);
  }
  const data = {
    kind,
    productId: target.type === "product" ? target.productId : null,
    variantId: target.type === "product" ? target.variantId : null,
    collectionId: target.type === "collection" ? target.collectionId : null,
    method: "manual" as const,
  };
  await tx.productLink.upsert({
    where: { shopId_attachment: { shopId, attachment } },
    create: { shopId, attachment, ...data },
    update: data,
  });
}

/** Marks products as universal; returns how many were new. Ids must be in the catalog cache. */
export async function addUniversal(
  shopId: string,
  productIds: string[],
): Promise<number> {
  const picked = Prisma.sql`SELECT p.product_id FROM catalog_products p
    WHERE p.shop_id = ${shopId} AND p.product_id = ANY(${productIds}::text[])
      AND p.status <> 'DELETED'`;
  try {
    // Under the link lock, so two adds (or an add and a manual link) can't pass the limit together.
    return await withLinkLock(
      shopId,
      async (tx) => {
        const over = await overLimitMessage(
          shopId,
          "products",
          async () => {
            const [{ before, after }] = await tx.$queryRaw<
              { before: number; after: number }[]
            >`
              WITH linked AS (${linkedProductsSql(shopId)})
              SELECT (SELECT count(*) FROM linked)::int AS before,
                     (SELECT count(*) FROM (SELECT product_id FROM linked
                       UNION ${picked}) x)::int AS after`;
            // Products that are linked already add nothing.
            return after > before ? after : 0;
          },
          tx,
        );
        if (over) throw new LinkRuleError(over);
        return tx.$executeRaw`
          INSERT INTO universal_products (shop_id, product_id)
          SELECT ${shopId}, x.product_id FROM (${picked}) x
          ON CONFLICT (shop_id, product_id) DO NOTHING`;
      },
      { lockTimeout: "5s" },
    );
  } catch (error) {
    if (isLockTimeout(error)) {
      throw new LinkRuleError(
        "Links are being checked right now. Try again in a moment.",
      );
    }
    throw error;
  }
}

export async function removeUniversal(shopId: string, productId: string) {
  const { count } = await prisma.universalProduct.deleteMany({
    where: { shopId, productId },
  });
  return count;
}
