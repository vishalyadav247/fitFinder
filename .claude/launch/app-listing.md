# FitFinder App Store listing

> Copy and asset list for the Partner Dashboard listing and the review form. Rules re-checked 2026-10-06 against the live docs:
> [App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements) (section 4: listing, 4.5: submission),
> [Best practices › App listing](https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices#5-app-listing) (character limits) and
> [Pass app review](https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review) (review instructions, screencast).
>
> Listing rules that apply to every text field and image: **no statistics or data, no guarantees, no "the best / the first / the only"** (4.3.3, 4.3.4); **pricing only in the Pricing section** — not in the intro, details, features, screenshots or icon (4.2.2, 4.2.3); no reviews or testimonials (4.3.6, 4.3.7); no Shopify logos or trademarks in graphics (4.4.3); don't mention your other apps or services (4.4).

## Basics

| Field | Value |
| --- | --- |
| App name | **FitFinder** (≤ 30 characters; lead with the brand). The TOML `name` is `fitFinder`: same words, so 4.1.1 "similar" is met — set it to `FitFinder` before the final `shopify app deploy` if you want them identical. Check that the name isn't taken by another app (4.1.2). |
| App icon | 1200 × 1200 px, PNG or JPEG, bold colours, simple shape with padding; **no text, no screenshots, no Shopify marks, no price** — **to create** |
| App card subtitle | "Help shoppers find products that fit their vehicle or device" (benefit, no keywords/stats; check the form's counter) |
| Category / tags | Store design › Search and filters (closest current category; tags must match the app's primary function, 4.3.5) |
| Search terms (≤ 5, one idea each) | fitment search, year make model, parts finder, product filter, vehicle search |
| Languages | English only (the admin UI is English; 4.3.2) |
| Sales channel requirement | Tick **"Merchant must have online store"** (theme app extension; 4.3.1) |
| Geographic requirements | None |
| Privacy policy URL | publish `privacy-policy.md` on a public page (your website, not a cloud doc) and paste the URL |
| Support | support email (must not contain "Shopify") + help center / FAQ URL. Set the same values in the app env (`SUPPORT_EMAIL`, `HELP_CENTER_URL`), otherwise Settings › Help shows two disabled buttons to the reviewer |
| Demo store URL | a development store with real-looking data — link straight to a product page that shows the fits badge and fitment table, with the search section on the home page |
| Integrations | none (leave empty) |

## Pricing (Pricing section only)

Billing method **Recurring charge** with one plan marked **Free** (shows "Free plan available"). Plans are configured in Shopify App Pricing (Partner Dashboard), handles `starter` / `growth` / `pro`, welcome link `/app/plans`:

| Plan | Price | Trial | Plan features (for the pricing card) |
| --- | --- | --- | --- |
| Starter | Free | — | 50 linked products · 5,000 filter rows |
| Growth | $29/month or $290/year | 14 days | 5,000 linked products · 500,000 filter rows |
| Pro | $99/month or $990/year | 14 days | Unlimited products and rows · priority support |

Limits from `app/services/billing.ts` `PLANS`. Keep the listing's pricing identical to the plans in the Partner Dashboard and to the Plans page in the app (4.2.1: include trial length and every charge). Per-plan **feature** lists: decide first (checklist 1.6) — today only the number limits are enforced, so don't list features as exclusive to a plan unless they are.

## App introduction (≤ 100 characters)

> Shoppers pick their vehicle and see only parts that fit, helping you cut wrong orders and returns.

(98 characters. Benefit-led, no numbers or guarantees. Non-automotive alternative, 94 characters: "Shoppers pick their car, phone or profile and see only products that fit, helping cut returns.")

## App details (≤ 500 characters)

> FitFinder adds a "find what fits" search to your store. Shoppers choose their vehicle, phone or profile from dropdowns you define and see only the products that fit. Start from a store type, then rename or add search fields. Import fitment data from a CSV in any column layout; rows link to your products by SKU, handle or collection. Add the search, a fits badge and a fitment table from the theme editor, with no code. Results open on your theme's own search page.

(466 characters. The earlier 836-character draft was over the 500 limit.)

## Feature list (≤ 80 characters each)

- Search by any fields: make, year and model, or brand, series and device (72)
- CSV import with column mapping, a review step and backups of recent files (74)
- Products linked automatically by SKU, handle or collection (58)
- Search section, fits badge and fitment table blocks for your theme (67)
- Live previews of every storefront block before shoppers see it (63)
- My Selection lets returning shoppers reuse a saved vehicle in one click (71)

## Feature media and screenshots

Feature image (1600 × 900, one focal point, solid background, contrast ≥ 4.5:1, alt text): the search widget with three dropdowns and a "Fits your vehicle" badge. No Shopify logo, no price, don't repeat the subtitle. Or a 2–3 minute promotional video (screen recordings ≤ 25 % of it).

Screenshots: **1600 × 900, 3–6, each a different screen, real UI, no browser chrome or desktop background, no PII, no prices** (4.4.4, 4.4.5). Take them on the demo store after the pilot import. The Plans page is excluded on purpose (it shows prices).

1. **Dashboard** — banner, setup guide and overview (store with data, guide partly done). Alt: "FitFinder dashboard with setup guide and store overview".
2. **Search setup** — the field grid (Make / Year / Model) and the Import CSV card on step 2, Map columns. Alt: "Mapping CSV columns to search fields".
3. **Storefront** — Theme integration table and the Search widget tab with its live preview. Alt: "Storefront settings with a live preview of the search".
4. **Product mapping** — unlinked SKUs and the product picker. Alt: "Linking SKUs to products".
5. **Shopper view: search section** on a theme page (crop to the page content). Alt: "Search by make, year and model on the storefront".
6. **Shopper view: product page** with the fits badge and the fitment table. Alt: "Fits badge and fitment table on a product page".

## Demo screencast (required, 4.5.3)

English (or English subtitles), unlisted YouTube/Vimeo/Loom link in the review form. Show step by step, on a development store, with the expected result of each step:

1. Install from the Partner Dashboard link → OAuth screen → app opens on onboarding (no menu yet).
2. Choose **Automotive** → Continue → Dashboard with the setup guide.
3. Search setup → Import CSV → upload `reviewer-sample.csv` → Map columns (auto-mapped) → Review → Import → toast and Import history row.
4. Filter data → the imported rows; add one row in the modal; delete one with the confirm modal.
5. Product mapping → unlinked SKUs → **Choose product** for one SKU → it moves to linked.
6. Storefront → App embed switch → theme editor (App embeds) → turn FitFinder on → Save → back in the app the badge shows On. **Add to theme** for Search section, Fits badge and Fitment table → each opens the theme editor with the block placed → Save → rows show Added.
7. Storefront (shop): pick Make → Year → Model → **Show parts** → the theme search page lists the fitting product; product page shows "Fits your vehicle" and the fitment table; My Selection saves the vehicle.
8. Plans → **Choose Growth** → Shopify's plan page → Approve → back on Plans (welcome link) with Growth and the trial badge → downgrade to Starter the same way.
9. Settings → Your data text; uninstall → storefront search disappears.

## Review notes (paste into the review form's testing instructions)

> **Test credentials:** none. FitFinder has no separate account or login; it uses the Shopify admin session only. Everything is reachable from the app menu after install.
>
> **What the app does:** a "find products that fit" search. The merchant defines the dropdowns (for example Make / Year / Model), imports fitment rows from a CSV, FitFinder links rows to products by variant SKU or handle, and theme app extension blocks show the search, a "fits" badge and a fitment table on the storefront.
>
> **Steps (about 10 minutes):**
> 1. Install and open the app. Onboarding asks for a store type: choose **Automotive** and click **Continue**.
> 2. **Search setup › Import CSV**: upload the attached `reviewer-sample.csv` (12 rows, columns Make, Year, Model, Attachment). The columns map automatically; click through Review and **Import**.
> 3. The sample's Attachment values are SKUs (`FF-BRAKE-001` …) that won't exist on your test store. Either give one or two test products these variant SKUs (they link within seconds), or open **Product mapping** and use **Choose product** on an unlinked SKU.
> 4. **Storefront › Theme integration**: turn on the **App embed** (opens the theme editor on App embeds; save there), then use **Add to theme** for Search section, Fits badge and Fitment table. Each button opens the theme editor with the block placed; click Save.
> 5. On the storefront, pick Make → Year → Model and click **Show parts**: the theme's search page lists the linked products. A linked product's page shows "Fits your vehicle" and the fitment table.
> 6. **Plans**: there is a free Starter plan; the app works on Starter limits until a plan is picked, so no plan is forced at install. To test billing: click **Choose** on Growth or Pro → Shopify's plan page → approve → you return to the Plans page (welcome link `/app/plans`) showing the plan and trial. Switch plans the same way to downgrade; cancelling returns the shop to Starter limits.
>
> **Demo store:** [demo store URL] (password: [password]) — product page with the badge and table: [URL].
> **Screencast:** [link].
> **Online Store required:** the storefront features are theme app extension blocks (Online Store 2.0 themes).
> **Customer data:** none stored; shopper selections stay in the shopper's browser.

Attach `reviewer-sample.csv` (this folder) to the submission, or host it and paste the link.
