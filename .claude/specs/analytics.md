# Analytics

**Prototype:** `design/scripts/screens/analytics.js` · **Route:** `/app/analytics` (menu item "Analytics", after Product mapping)

## Purpose
Shows how shoppers use the search on the storefront, so the merchant can see what is searched, which searches find nothing (and fix them), and which products shoppers check but that don't fit. Read-only. Added 2026-10-13 at the product owner's request; available on every plan.

## Layout (top to bottom)
`PageHeader` "Analytics"; on the right a period `s-select` (label hidden): **Last 7 days / Last 30 days** (default) **/ Last 90 days** (`?days=`).

**No data yet** (no count recorded for the shop, in any period): one section with `EmptyState` (chart icon) "No searches yet": "When shoppers use the search on your store, you'll see here what they look for, which searches find nothing and how often your {products} fit what shoppers selected." + primary **Open storefront settings** (→ Storefront). Nothing else.

Otherwise:

1. **Cards** (4 in a row, 2 on phones; Dashboard overview look, not clickable): label · number · one muted line.
   | Card | Number | Line |
   |---|---|---|
   | Searches | searches in the period | "+12% vs the previous 30 days" / "Same as …" / "None in the previous 30 days" |
   | Found products | % of searches with products ("—" without searches); warning badge "Needs attention" when any found nothing | "{n} searches found nothing" / "Every search found products" |
   | Different selections | different selections searched | "Searched at least once" |
   | Product page checks | fits badge checks with a selection | "{pct}% fit the shopper's selection" / "No product page opened with a selection" |
2. **Searches per day** (section, chart icon): one column per day in the theme colour (one series, no legend), recessive grid with 0 / half / max, first, middle and last day under the axis. A readout line above shows "{total} searches · up to {max} a day"; hovering or focusing a column shows "{Oct 3} · {n} searches · {m} found nothing". Each column is a focusable button with that text as its label.
3. **Searches that found nothing** (alert icon): "Every search in this period found {products}." when none. Otherwise text "Shoppers searched for these, but no {products} were shown: the SKUs in their filter rows aren't linked to an active product. Link them in Product mapping." + button **Open product mapping**, and a table (top 10 by "found nothing"): {selection} · Found nothing · Last time · Now (`Finds products` success badge when the selection finds products today, `Still nothing` warning, "—" when it couldn't be checked).
4. **Top searches** (search icon): "What shoppers searched most. Keep their filter rows complete and their {products} in stock." Table (top 10): {selection} · Searches · Found nothing ("—" for 0).
5. **Most searched by field** (list icon) with a field `s-select` on the right (`?field=`, default the first field): table (top 10) of that field's values: value · Searches · Share (bar relative to the top value).
6. **Product pages** (product icon): "How often shoppers opened a product page with a selection, and whether the product fits it. Many "doesn't fit" checks can mean the product is missing filter rows for what your shoppers select." Table (top 10 by checks): Product · Checks · Fits · Doesn't fit. A product deleted since shows "Removed product".
7. Muted footnote: "Days are in UTC and counts are kept for 180 days. SpareFit only counts searches; it records nothing about your shoppers."

A selection reads as its values in search field order joined by " › " (e.g. "Oily › Acne" or "Apple › iPhone 15"); values of fields removed since are left out ("Fields removed since" when none is left). The {selection} column header is the search field names joined the same way (e.g. "Skin type › Concern"). {products} is the store type's products word. The page never uses the store type's noun or any store-type-specific word (agreed 2026-10-13: it must read right for every store type).

## What is counted
Recorded by the app proxy routes, after answering, never delaying or failing the shopper's request (a busy store just loses the count):
- **Search** = a "Show {products}" click (`GET search` with a full selection). It "found nothing" when no product fits through the selection's rows; universal products don't count as found. Selections that match no filter row (made-up requests; the dropdowns can't produce them) are not counted.
- **Product page check** = a fits badge request with a full selection (`GET fits`; the fitment table's call without a selection isn't one): fits (also universal) or doesn't fit. Only products in the shop's catalog cache are counted.
- Results-page paging and dropdown loads are not counted. The browser may reuse a `search`/`fits` answer for 30 s, so an identical repeat within that time isn't counted again.

## Data / backend
- Tables `search_stats` (shop_id, day, selection_key = md5 of the picks, picks, searches, no_results) and `fit_check_stats` (shop_id, day, product_id, fits, no_fit), one row per shop, UTC day and selection / product, incremented with an upsert (`app/services/analytics/record.server.ts`). No shopper data (no ids, IPs or sessions). Cascade on shop delete.
- The daily purge job deletes counts older than 180 days (`purgeOldStats`).
- Loader: `analyticsReport` + `fieldValues` (`app/models/analytics.server.ts`), and for each "found nothing" selection a current `fitSkus` check for the Now column. Wording and numbers in `app/services/analytics/report.ts`.
