// How a filter row's Attachment points at the store (specs/product-mapping.md). Rule-based, no AI:
// the Attachment is a variant SKU, matched regardless of case and outer spaces. Anything that
// doesn't match a SKU stays unlinked until the merchant links it by hand (Choose product).
// Pure; the same key is computed in SQL (catalog.server.ts lookupKeySql), keep them in sync.

/** Most products one "Add products" pick may add (one Admin API nodes() call). */
export const MAX_PICK = 250;

// Characters trimmed from both ends of an attachment or SKU (same set as TRIM_CHARS in SQL).
const EDGES = /^[ \t\r\n\u00a0]+|[ \t\r\n\u00a0]+$/g;

/** What an attachment or SKU is matched by: trimmed, lower case. */
export const lookupKey = (s: string) => s.replace(EDGES, "").toLowerCase();

const GID_RE = /^gid:\/\/shopify\/(Product|ProductVariant)\/\d{1,20}$/;

/** Admin GraphQL gid of a product or variant (resource picker ids). */
export function gidType(id: string): "Product" | "ProductVariant" | null {
  const m = id.match(GID_RE);
  return m ? (m[1] as "Product" | "ProductVariant") : null;
}
