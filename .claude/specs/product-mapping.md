# Product mapping

**Prototype:** `design/scripts/screens/product-mapping.js` · **Suggested route:** `/app/product-mapping`

## Why this page exists
A filter row only says "attachment X fits Make / Year / Model". The attachment is text from the merchant's CSV (usually a SKU, sometimes a product or collection link). To show anything to shoppers, FitFinder must know **which product in the store** that text means:
- **Search results** need the real product (title, image, price, Add to cart). An unlinked row can't be shown.
- **The Fits badge** sits on a product page; it can only answer "does this fit?" if that product is linked to rows.
- **The reverse problem**: a product with no rows never appears in any search, even if it fits everything.

Most links are made automatically on import (the attachment matches a variant SKU, product link or collection link). This page handles what's left: rows we couldn't match, products nothing points to, and products that fit everything.

## Layout
`s-page heading="Product mapping"` · primary **Check links again** (`icon="refresh"`; re-runs matching, e.g. after adding products; toast "Links checked. {n} new matches").

1. **Unlinked rows** (`s-section padding="none"`) — title + warning badge "{n} to link" (success when 0) + "Each filter row points to a product through its Attachment (usually a SKU). We couldn't find these in your store, so shoppers don't see them in search results."
   - `s-table`, one line per attachment: **Attachment** · **Type** (SKU / Product link / Collection link) · **Fits** (first row's values + "+n more") · **Rows** (how many rows use it) · **Choose product** (Shopify resource picker; links every row with that attachment; toast "{attachment} linked to a product").
   - None: success banner "Every row is linked to a product".
2. **Products without filter data** — title + badge "{n} products" + "These products have no filter rows, so they never appear in a search. Add rows for them, or mark them as universal if they fit every {noun}."
   - `s-table`: **Product** · **SKU** · **Add filter row** (opens Filter data with the Add row modal, SKU pre-filled; saving links it) + tertiary **Mark as universal** (moves it to the list below; toast).
   - None: success banner "Every product has filter data or is universal".
3. **Universal products** — title + "Shown in every search result, whatever the shopper picks. For example tools, cleaning kits or cables." + **Add products** (resource picker).
   - `s-table`: **Product** · **SKU** · tertiary **Remove** (back to "without filter data"; not a data delete, so no confirmation). Empty: "No universal products yet."

There is no "match by" setting here: the import's **Attachment** column (and "Look for SKUs in the Attachment column") decides how rows link to products.

## Data / backend
- Matching runs after every import and on **Check links again**: attachment → variant SKU (when "Look for SKUs" was on), product handle/URL, or collection handle/URL. Results in `product_links`.
- `GET /api/links/unlinked?page=` (grouped by attachment) · `PUT /api/links/{attachment}` `{ productId, variantId }`.
- `GET /api/products/without-fitment?page=` — store products whose SKUs match no row and that aren't universal (product SKU cache from `products/*` webhooks or a bulk query).
- `GET/PUT /api/universal-products`.
- Keep links fresh with `products/update` and `products/delete` webhooks (SKU changes, deleted products → row becomes unlinked again).

## Build notes
Plain Polaris. Matching is rule-based (no AI). Toasts for every action (Shopify toast).
