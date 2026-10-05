// How a filter row's Attachment points at the store (specs/product-mapping.md). Rule-based, no AI:
//   - a link containing /products/{handle}    → that product
//   - a link containing /collections/{handle} → that collection (unless it also has /products/)
//   - anything else ("bare") → a variant SKU, or else a product with that handle.
// "Look for SKUs in the Attachment column" (import) doesn't change these rules: one import's
// setting must not reclassify every row of the shop (PROGRESS.md M6 decision).
// Pure; the same rules run in SQL in relink.server.ts (attachmentKindSql), keep them in sync.

/** Most products one "Add products" pick may add (one Admin API nodes() call). */
export const MAX_PICK = 250;

export type AttachmentKind = "sku" | "product" | "collection";

export interface ClassifiedAttachment {
  /** "sku" for bare attachments: they are looked up as a SKU first, then as a product handle. */
  kind: AttachmentKind;
  /** What to look up: lower-case trimmed SKU or handle. */
  key: string;
}

// Same character class as the SQL patterns: a handle ends at /, ?, # or whitespace.
const PRODUCT_RE = /\/products\/([^/?#\s]+)/i;
const COLLECTION_RE = /\/collections\/([^/?#\s]+)/i;
// Characters trimmed from both ends of a bare attachment or SKU (same set as TRIM_CHARS in SQL).
const EDGES = /^[ \t\r\n\u00a0]+|[ \t\r\n\u00a0]+$/g;

export const lookupKey = (s: string) => s.replace(EDGES, "").toLowerCase();

export function classifyAttachment(attachment: string): ClassifiedAttachment {
  const product = attachment.match(PRODUCT_RE);
  if (product) return { kind: "product", key: product[1].toLowerCase() };
  const collection = attachment.match(COLLECTION_RE);
  if (collection) {
    return { kind: "collection", key: collection[1].toLowerCase() };
  }
  return { kind: "sku", key: lookupKey(attachment) };
}

/** The Type column of Unlinked rows. */
export function kindLabel(kind: AttachmentKind): string {
  return kind === "sku"
    ? "SKU"
    : kind === "product"
      ? "Product link"
      : "Collection link";
}

const GID_RE =
  /^gid:\/\/shopify\/(Product|ProductVariant|Collection)\/\d{1,20}$/;

/** Admin GraphQL gid of a product, variant or collection (resource picker ids). */
export function gidType(
  id: string,
): "Product" | "ProductVariant" | "Collection" | null {
  const m = id.match(GID_RE);
  return m ? (m[1] as "Product" | "ProductVariant" | "Collection") : null;
}

/** The attachment "Add filter row" pre-fills for a product without a SKU. */
export function productLinkAttachment(handle: string): string {
  return `/products/${handle}`;
}
