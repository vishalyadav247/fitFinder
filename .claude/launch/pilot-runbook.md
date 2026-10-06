# Pilot runbook: Bilstein NL data on a staging store (M11)

Goal (BUILD-PLAN M11): Bilstein NL's real fitment data live on a staging store, end to end, before submitting. Steps marked **(you)** need your accounts; the rest is checked in this repo.

## 0. Before you start

- [ ] **(you)** Deploy to Fly.io EU (web + worker or `JOBS_INLINE=true`), managed Postgres EU, `STORAGE_DRIVER=r2` with the R2 bucket and its CORS for PUT from the app origin (PROGRESS › Follow-ups). Set `DATABASE_URL` with `?connection_limit=…` and keep `PROXY_MAX_QUERIES` below it.
- [ ] **(you)** Fly proxy/request timeout ≥ 120 s (Delete all, Remove duplicates and field rewrites run in the request).
- [ ] **(you)** Env: `SHOPIFY_API_KEY/SECRET`, `SHOPIFY_APP_URL`, Partner billing vars (`SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_ACCESS_TOKEN`, `SHOPIFY_APP_GID`, `SHOPIFY_APP_HANDLE`), `SUPPORT_EMAIL`, `HELP_CENTER_URL`.
- [ ] **(you)** Partner Dashboard: create the three plans (handles `starter`, `growth`, `pro`; welcome link `/app/plans`; paid plans "free for partners and developers"), app icon, emergency contact.
- [ ] **(you)** `shopify app deploy` (config with compliance webhooks, scopes `read_products,write_app_proxy,read_themes,write_files`, theme extension).

## 1. Staging store

- [ ] **(you)** Development store with a clean **Horizon** theme (Shopify's Lighthouse baseline) and Dawn as a second theme.
- [ ] **(you)** Products whose variant SKUs are Bilstein article numbers (`Artikelnummer`, e.g. `33-316321`, `24-249584`). Without matching SKUs, rows stay unlinked (Product mapping shows them).
- [ ] **(you)** Lighthouse **before**: `npm run perf:lighthouse -- --label before --home URL --product URL --collection URL` (FitFinder not installed or embed off, no blocks).

## 2. Install and set up

- [ ] Install → onboarding opens → choose **Automotive** (fields Make, Year, Model).
- [ ] Optional extra fields for Bilstein: add **Type** (`KFZTyp`, e.g. "2.0 All-wheel Drive") and **Power** (`PS`) as Dropdowns on Search setup if shoppers should pick them.

## 3. Import the Bilstein file

Source: `bilstein_upload.csv` from the Bilstein NL repo (`.claude/resources/upload/`). Header (German, comma-separated):

`Hersteller, Modell, BJVon, BJbis, KFZTyp, PS, Artikelnummer, Artikel-Kriterien, Artikel-Infos, Suspension, Suspension VA, Suspension HA, Lowered Suspension ca. [mm] VA/HA, VIN from/to`

| Bilstein column | FitFinder target |
| --- | --- |
| Hersteller | Make |
| BJVon | Year (from) — `MM/YY`, e.g. `08/24` → 2024 |
| BJbis | Year (to) — `/` = still produced (open range) |
| Modell | Model |
| KFZTyp | Type (if added) or Skip |
| PS | Power (if added) or Skip |
| Artikelnummer | Attachment (SKU) |
| everything else | Skip |

FitFinder has no Bilstein-specific header aliases (decided in M4), so map the columns once in step 2 of the import; the mapping is remembered for the next import.

- [ ] Search setup › Import CSV → upload → map as above → Review: note **added / errors**; download the error report and check what was refused.
- [ ] Import (Add and update). Record the time for the full file.
- [ ] Product mapping: Check links again → unlinked SKUs should be only those without a product.
- [ ] **Local dry run first (optional, recommended):** copy the file into this repo (`.data/pilot/bilstein_upload.csv`, gitignored) with `! cp "<Bilstein repo>/.claude/resources/upload/bilstein_upload.csv" .data/pilot/` and ask Claude to run `npx tsx scripts/perf-import.ts .data/pilot/bilstein_upload.csv` — it prints check-run and import timings and counts on a throwaway local shop (map columns there by header). The Bilstein repo itself stays read-only.

## 4. Storefront

- [ ] Storefront: App embed switch → theme editor → enable FitFinder → save; back in the app the badge shows **On**.
- [ ] Add to theme: Search section (home), Fits badge and Fitment table (product template).
- [ ] Shopper test: pick Make → Year → Model; **Show parts** opens the theme search page with exactly the fitting products; badge says "Fits your vehicle" on a fitting product and "Doesn't fit" otherwise; fitment table lists the rows; My Selection saves and switches.
- [ ] Lighthouse **after**: `npm run perf:lighthouse -- --label after …` → must report PASS (≤ 10 points).
- [ ] Repeat the storefront checks on Dawn.

## 5. Billing and compliance

- [ ] Plans → pick Growth on Shopify's page → back on Plans the plan and trial show; downgrade to Starter works.
- [ ] `shopify app webhook trigger` for `customers/data_request`, `customers/redact`, `shop/redact` → 200 and log lines.
- [ ] Uninstall → storefront search disappears (proxy 404); reinstall within 30 days → data is back.

## 6. Record

- [ ] Timings, error counts and any surprises in `.claude/PROGRESS.md` (M11 row); screenshots for the listing from this store (see `app-listing.md`).
