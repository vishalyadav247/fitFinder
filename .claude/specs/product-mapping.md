# Product mapping

**Prototype:** `design/scripts/screens/product-mapping.js` · **Suggested route:** `/app/product-mapping`

## Why this page exists
A filter row only says "attachment X fits Make / Year / Model". The attachment is text from the merchant's CSV (usually a SKU, sometimes a product or collection link). To show anything to shoppers, FitFinder must know **which product in the store** that text means:
- **Search results** need the real product (title, image, price, Add to cart). An unlinked row can't be shown.
- **The Fits badge** sits on a product page; it can only answer "does this fit?" if that product is linked to rows.
- **The reverse problem**: a product with no rows never appears in any search, even if it fits everything.

Most links are made automatically on import (the attachment matches a variant SKU, product link or collection link). This page handles what's left: rows we couldn't match, products nothing points to, and products that fit everything.

## Layout
`s-page heading="Product mapping"` · primary **Check links again** (`icon="refresh"`; reloads the store's products from Shopify and re-runs matching, e.g. after adding products; loading while it runs; toast "Links checked. {n} new matches" / "Links checked. 1 new match" / "Links checked. No new matches"; error toast "Links couldn't be checked. Try again."). If a check is already running, the request runs again right after it.

1. **Unlinked rows** (`s-section padding="none"`) — title + warning badge "{n} to link" (success when 0) + "Each filter row points to a product through its Attachment (usually a SKU). We couldn't find these in your store, so shoppers don't see them in search results."
   - `s-table`, one line per attachment, most rows first, paged (see table footer below): **Attachment** · **Type** (SKU / Product link / Collection link: a link with `/products/` or `/collections/`, anything else is a SKU) · **Fits** (first row's values + "+n more") · **Rows** (how many rows use it) · **Choose product** (Shopify product picker; links every row with that attachment; toast "{attachment} linked to a product"). Collection links get **Choose collection** instead (collection picker; toast "{attachment} linked to a collection").
   - None: success banner "Every row is linked to a product".
2. **Products without filter data** — title + badge "{n} products" + "These products have no filter rows, so they never appear in a search. Add rows for them, or mark them as universal if they fit every {noun}."
   - `s-table` (active products only, paged): **Product** · **SKU** (first variant SKU, "—" when none) · **Add filter row** (opens Filter data with the Add row modal, SKU pre-filled, or `/products/{handle}` for a product without a SKU; saving links it) + tertiary **Mark as universal** (moves it to the list below; toast "{title} is now universal").
   - None: success banner "Every product has filter data or is universal".
3. **Universal products** — title + "Shown in every search result, whatever the shopper picks. For example tools, cleaning kits or cables." + **Add products** (product picker, up to 250; toast "{title} is now universal" for one, "{n} products added to universal products" for several).
   - `s-table` (paged): **Product** · **SKU** · tertiary **Remove** (back to "without filter data"; not a data delete, so no confirmation; toast "{title} is no longer universal"). Empty: "No universal products yet."

**Table footer (all three tables):** "Showing {from}–{to} of {total} {attachments|products}" · left · previous · "Page {x} of {y}" · next, centred · **Rows per page** select (10 / 25 / 50, default 10; resets to page 1) on the right. Each table pages on its own (`?u= &un=`, `?p= &pn=`, `?x= &xn=`). The prototype shows plain tables without this footer; the app is the reference.

**First visit (products not loaded yet):** the store's products are loaded in the background. Both badges are hidden and sections 1 and 2 show a subdued "Loading your products from Shopify…" (or "Your products couldn't be loaded yet. Click Check links again." if loading failed).

**Error toasts:** "That product no longer exists." / "That collection no longer exists." · "{title} is already universal." · "No filter rows use this attachment any more. Refresh the page." · "Links are being checked right now. Try again in a moment." · "That change couldn't be saved. Try again."

There is no "match by" setting here, and "Look for SKUs in the Attachment column" (import) doesn't change matching either (decided in M6: one import's setting must not reclassify all of a shop's rows).

## Data / backend
- **Matching** (rule-based, `app/services/linking/relink.server.ts`) runs after every import (quick: against the cached products), on **Check links again** (full: reloads the catalog first) and when a row is added or edited in Filter data. Attachment → product link (`/products/{handle}`), collection link (`/collections/{handle}`), otherwise variant SKU, then product handle (upper/lower case and outer spaces ignored). Several variants with the same SKU: active products first, then the oldest. Results in `product_links` (`method` auto/manual); matching never changes a manual link.
- **Catalog cache** (`catalog_products`, `catalog_variants`, `catalog_collections`): filled by a bulk operation (products + variants) and a paged collections query; kept fresh by `products/create|update|delete` webhooks, which queue a per-product job that reads the product again from the Admin API (late or out-of-order webhooks can't leave stale data). A deleted product's rows become unlinked, or link to another product with the same SKU.
- Page loader (`/app/product-mapping?u=&p=&x=`, the three page numbers): unlinked groups, products without filter data (active products that no link with rows behind it points to, and not universal), universal products. `GET /api/links/status` is polled while a check runs.
- Actions (route intents, zod-validated): `check`, `link` (`attachment`, `resourceId` product or collection gid, optional `variantId`; the resource is read from Shopify before linking), `universal-add` (`ids`), `universal-mark`, `universal-remove` (`productId`).
- Known gap: products reached only through a collection link are listed under "without filter data" (collection membership isn't cached).

## Build notes
Plain Polaris. Matching is rule-based (no AI). Toasts for every action (Shopify toast).
