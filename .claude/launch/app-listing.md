# FitFinder App Store listing (draft)

> Draft copy and asset list for the Partner Dashboard listing. Requirements checked 2026-10-06 against https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices and https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review. Avoid data claims you can't back up, Shopify logos, pricing in images, and duplicate screenshots (requirements 4.4.4 / 4.4.5).

## Basics

| Field | Draft |
| --- | --- |
| App name | FitFinder (working name; final name to decide) |
| App icon | 1200 × 1200 px, PNG or JPG — **to create** |
| Category | Store design › Search and filters (pick the closest current category) |
| Languages | English (primary) |
| Pricing | Starter free · Growth $29/month or $290/year · Pro $99/month or $990/year; 14-day free trial on paid plans (plans in Shopify App Pricing, handles `starter` / `growth` / `pro`) |
| Privacy policy URL | publish `.claude/launch/privacy-policy.md` and paste the URL |
| Support | support email + help center URL (also set `SUPPORT_EMAIL` / `HELP_CENTER_URL` so Settings › Help works) |
| Demo store | a development store with real-looking data (see pilot runbook) — link straight to a product page with the fits badge |

## App introduction (≤ 100 characters)

> Shoppers pick their vehicle and see only parts that fit. Fewer wrong orders, fewer returns.

(91 characters. For a non-automotive angle: "Shoppers pick their car, phone or profile and see only products that fit. Fewer returns.")

## App details (description)

> FitFinder adds a "find what fits" search to your store. Shoppers choose their vehicle, phone or profile from dropdowns you define, and only see the products that fit it.
>
> Set it up your way: start from a store type (automotive, phones and accessories, beauty and personal care, or anything else) and rename, reorder or add search fields. Import your fitment data from a CSV in any column layout and check the columns before anything is imported. FitFinder links each row to your products by SKU, handle or collection.
>
> On your storefront, add a search section, a "fits your vehicle" badge and a fitment table on product pages from the theme editor — no code. Results open on your theme's own search page, so your product cards and filters stay as they are. My Selection lets returning shoppers pick their saved vehicle again in one click.

## Feature list (short bullets)

- Search by any fields: make, year, model — or brand, series, device
- CSV import with column mapping, review step and backups of the last 5 files
- Automatic product linking by SKU, handle or collection
- Search section, fits badge and fitment table blocks, plus My Selection
- Live previews of every storefront block before you publish
- Works with Online Store 2.0 themes through theme app extensions

## Screenshots (1600 × 900, 3–6, each a different screen, no browser chrome)

1. **Dashboard** — banner, setup guide and overview (a store with data, guide partly done). Alt: "FitFinder dashboard with setup guide and store overview".
2. **Search setup** — the field grid with Make / Year / Model and the Import CSV card on step 2 (Map columns). Alt: "Mapping CSV columns to search fields".
3. **Storefront** — Theme integration table and the Search widget tab with its live preview. Alt: "Storefront settings with a live preview of the search".
4. **Product mapping** — unlinked SKUs and the product picker. Alt: "Linking SKUs to products".
5. **Storefront: search section on a product-rich theme page** (the shopper view; crop to the page content, no browser frame). Alt: "Search by make, year and model on the storefront".
6. **Storefront: product page** with the fits badge and the fitment table. Alt: "Fits badge and fitment table on a product page".

Feature image (1600 × 900, one focal point, solid background): the search widget with three dropdowns and a "Fits your vehicle" badge.

## Review notes (for the reviewer, in the submission form)

- Install, choose a store type, import the sample CSV attached in the notes (or use the demo store), then open Storefront › Theme integration and add the blocks with the **Add to theme** buttons (theme editor deep links).
- The app embed is required for My Selection and the code-in-tabs option; turn it on from the App embed switch.
- Plans: choose any plan on Shopify's plan page from Plans; a shop without a plan has Starter's limits.
- Test credentials: none needed.
