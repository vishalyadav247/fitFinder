# FitFinder — Build plan

How to turn the prototype (`.claude/design/`) into the real Shopify app. Read with `.claude/CLAUDE.md` (rules) and the screen specs in `.claude/specs/` (what each screen does). Where this plan and a spec disagree, the spec wins for UI and this plan wins for architecture; flag the conflict.

Items marked **(verify)** must be checked against current shopify.dev docs before coding; Shopify APIs change every quarter.

## 1. Stack

| Part | Choice | Notes |
| --- | --- | --- |
| App framework | Shopify app **React Router template** (`shopify app init`), TypeScript | Shopify's recommended path; uses `@shopify/shopify-app-react-router` for auth, App Bridge and Admin API |
| Admin UI | **Polaris web components** (`s-page`, `s-section`, `s-table`, `s-modal` …) + App Bridge (`s-app-nav`, toast, resource picker, save bar) | No other UI kit. Match the prototype markup |
| Database | PostgreSQL + Prisma | Template ships Prisma; add our tables. Sessions in Prisma session storage |
| Background jobs | **pg-boss** on the same Postgres (decided 2026-10-05) | Imports of 700k rows must not run in a request; a separate worker process runs the jobs |
| Cache | Postgres distinct-values tables (decided; no Redis) | Dropdown options per shop and per field path |
| File storage | **Cloudflare R2** (S3-compatible) (decided) | Original uploads of the last 5 imports per shop (backups), error reports, exports |
| Storefront | **Theme app extension**: 3 app blocks + 1 app embed, vanilla JS (no jQuery), small CSS | Data via **app proxy** |
| Billing | **Shopify Managed Pricing** (plans set in the Partner Dashboard) | Read the active subscription; enforce limits server-side |
| Hosting | **Fly.io, EU region** with the template Dockerfile; managed Postgres (Neon or Supabase, EU) (decided) | Web process + worker process |

## 2. Repository layout (target)

```
productFinder/                   (project root: React Router template, TypeScript, scaffolded 2026-10-05; .claude/ sits alongside)
├── app/
│   ├── routes/
│   │   ├── app._index.tsx              Dashboard              → .claude/specs/dashboard.md
│   │   ├── app.onboarding.tsx          Onboarding             → onboarding.md
│   │   ├── app.search-setup.tsx        Search setup + import  → search-setup.md
│   │   ├── app.filter-data.tsx         Filter data            → fitment-data.md
│   │   ├── app.storefront.tsx          Storefront             → storefront.md
│   │   ├── app.product-mapping.tsx     Product mapping        → product-mapping.md
│   │   ├── app.settings.tsx            Settings               → settings.md
│   │   ├── app.plans.tsx               Plans                  → plans.md
│   │   ├── api.*.ts                    Admin JSON endpoints (session token)
│   │   ├── proxy.*.ts                  App proxy endpoints (signature verified)
│   │   └── webhooks.*.ts               Webhook handlers
│   ├── models/                         Prisma queries per entity
│   ├── services/
│   │   ├── import/                     Parser, column guesser, modes, job runner (port of the Bilstein engine)
│   │   ├── fitment/                    Matching, year ranges, cascading options, fit check
│   │   ├── linking/                    Attachment → product/variant/collection matching
│   │   ├── storefront-sync.ts          Settings → app metafield
│   │   └── billing.ts                  Plan + limits
│   ├── components/                     Shared admin pieces (setup guide, banner, preview widgets)
│   └── shopify.server.ts
├── extensions/
│   └── fitfinder-theme/
│       ├── blocks/search.liquid        Search section (target: section)
│       ├── blocks/fits-badge.liquid    Fits badge (target: section, product)
│       ├── blocks/fitment-table.liquid Fitment table (target: section, product)
│       ├── blocks/app-embed.liquid     App embed (target: body): loader, My Selection, [fitfinder-table] swap
│       ├── assets/fitfinder.js / .css
│       └── locales/en.default.json
├── prisma/schema.prisma
└── shopify.app.toml
```

## 3. Data model

Start from `.claude/specs/data-model.md`. Additions and decisions:

| Table | Columns (main) | Notes |
| --- | --- | --- |
| `shops` | id, domain (unique), installed_at, uninstalled_at, last_auth_at, plan, trial_ends_at | Purge data 30 days after `uninstalled_at` |
| `search_configs` | shop_id (PK), store_type, heading, noun, things_word | Store type presets live in code (copy from `.claude/design/scripts/data/store-types.js`) |
| `search_fields` | id, shop_id, position, label, placeholder, type (`list`/`year_range`), required | Ordered; label/placeholder shown on the storefront |
| `fitment_rows` | id, shop_id, values jsonb `{fieldId: value}`, year_from, year_to, attachment, row_hash (unique per shop), created_at | `attachment` = SKU, product URL/handle or collection URL/handle; `row_hash` = hash(values + year_from/year_to + attachment) for add/update and dedupe |
| `product_links` | shop_id, attachment, kind (`sku`/`product`/`collection`), product_id, variant_id, collection_id, method (`auto`/`manual`) | Unique (shop_id, attachment) |
| `universal_products` | shop_id, product_id | Shown in every result |
| `import_mappings` | shop_id, column_name, target (`field:{id}`, `field:{id}:from`, `:to`, `:range`, `attachment`, `skip`) | Pre-fills the next import |
| `import_jobs` | id, shop_id, file_name, file_key (object storage), mode (`upsert`/`replace`/`delete`), mapping jsonb, look_for_skus, has_header, status, added, updated, unchanged, deleted, not_found, errors, error_report_key, created_at | Keep files of the last 5 jobs; delete older files |
| `storefront_settings` | shop_id (PK), settings jsonb | Every Storefront-page setting (see the key list in data-model.md); mirrored to an app metafield |
| `theme_status` | shop_id, theme_id, embed_on, blocks jsonb, table_code_found, checked_at | Cache of what is added to each theme |

Year ranges: store `year_from`/`year_to` (open range: `year_to = null`) and expand to single years only when building dropdown options.

Indexes: (shop_id, attachment); (shop_id, row_hash) unique; GIN on `values`; for 700k-row shops precompute distinct option values per field path (cache), invalidated after every import or edit.

## 4. Key flows

### Import (Search setup → Import CSV)
1. Upload (`.csv`/`.csv.gz`, ≤ 100 MB) straight to object storage (staged upload), create `import_jobs` row.
2. Read the header + first 3 rows → columns with samples. Pre-fill targets: saved `import_mappings` first, then header-name rules (no AI).
3. Merchant maps columns (one target per column; a Year range field takes one range column or a from + to pair; Attachment required). Save mapping.
4. Dry run in the job queue → counts per mode (added / updated / unchanged / errors, or deleted / not found / left) + error report → Review step.
5. Run: stream in 50k-row batches (Bilstein engine), upsert by `row_hash` (or replace / delete by exact match). Progress events to the admin.
6. After: re-run linking for new attachments, rebuild the options cache, update the storefront metafield counts, keep 5 newest files.

### Linking (Product mapping)
- With "Look for SKUs in the Attachment column": match against variant SKUs (bulk operation export of products → SKU map, refreshed by `products/*` webhooks). Otherwise treat the attachment as a product or collection handle/URL.
- Unlinked rows grouped by attachment; **Choose product** = App Bridge resource picker → manual link for every row with that attachment.
- "Products without filter data" = products whose SKUs match no row and aren't universal.

### Storefront
- Blocks read settings from the app metafield; the app embed loads `fitfinder.js` once (deferred).
- App proxy endpoints: `options` (next dropdown values for the picks so far), `search` (the SKUs that fit → the theme's own search page, so its product cards and filters apply; decided 2026-10-05, specs/storefront.md › Results), `results` (FitFinder's own results page, the fallback for long SKU lists), `fits` (badge state + table rows for a product).
- My Selection: saved in `localStorage` on the shopper's device; floating tab per the spec (fixed size, ellipsis, hover hint card, panel with slide animation, close tile).
- Fitment table in theme tabs: the app embed finds the text `[fitfinder-table]` on product pages and replaces it with the table (respects all table settings).
- Theme status: list themes (GraphQL `themes`), read `config/settings_data.json` for the embed state and scan templates for our blocks / the code **(verify** asset read access and scopes). "Add to theme" / "View in editor" / app-embed switch = theme editor deep links (`/admin/themes/{id}/editor?context=apps&activateAppId={api_key}/{handle}` for the embed; `addAppBlockId` for blocks) **(verify)**.

### Billing
- Managed Pricing plans: Starter (free), Growth, Pro; monthly + yearly. Plans page links to Shopify's hosted plan page. `app_subscriptions/update` webhook updates `shops.plan`. Limits (rows, linked products, fields) enforced in import and field APIs; over-limit → banner with upgrade link.

### Privacy and uninstall
- `app/uninstalled`: mark shop, stop serving the proxy, schedule purge after 30 days.
- GDPR webhooks `customers/data_request`, `customers/redact`, `shop/redact`: we hold no customer data (My Selection is in the shopper's browser); respond and log; `shop/redact` purges everything.

## 5. Milestones and acceptance criteria

| # | Milestone | Done when |
| --- | --- | --- |
| M1 | Scaffold + auth + data model | App installs on a dev store; `shops` row created; Prisma schema migrated; nav matches the prototype (`s-app-nav`) |
| M2 | Onboarding + store types | Choosing a type creates fields and wording (noun, products word) exactly as `store-types.js` (no sample rows: specs/onboarding.md); "Change store type" confirms and replaces fields |
| M3 | Search setup — fields | Inline field grid (name, placeholder, type, required, reorder, delete with confirm) saves on change; matches `search-setup.md` |
| M4 | Import pipeline | 3-step import card works for all 3 modes on a 727k-row Bilstein file within agreed time; mapping remembered; review counts real; destructive modes confirm; history keeps 5 files with working downloads |
| M5 | Filter data | Search, add/edit popup, delete (confirmed), bulk delete, export (all/selected/unlinked) round-trips through import unchanged; remove duplicates |
| M6 | Linking + Product mapping | Auto-linking after import; unlinked list grouped by attachment; resource picker links; products without filter data; universal products |
| M7 | Theme app extension | Search section, fits badge (3 states), fitment table (block + `[fitfinder-table]` in theme tabs), My Selection embed (4 positions, icons incl. custom upload, colours, count, hover hint, panel) all match the prototype on Dawn and one non-Dawn theme |
| M8 | Storefront page | Theme picker + embed status per theme; feature table with Type / Placement / Status / Action and deep links; tab settings write to the metafield; previews match the storefront |
| M9 | Dashboard, Settings, Plans | Setup guide steps reflect real state; overview counts real; Managed Pricing upgrade/downgrade works on a dev store; limits enforced |
| M10 | Compliance + performance | GDPR webhooks; purge job; storefront script within Built for Shopify thresholds (verify current limits); Lighthouse impact measured on Dawn |
| M11 | Pilot + submission | Bilstein NL data live on a staging store; App Store listing, screenshots, privacy policy; submitted |

## 6. Rules that come from the design work (do not undo)

- No AI features anywhere (matching, mapping and translations are rule-based or manual).
- Plain Polaris everywhere except three custom areas: dashboard banner, setup guide, onboarding cards.
- Every delete or destructive import asks for confirmation in an `s-modal`; notifications are App Bridge toasts; add/edit forms are modals.
- Section headings are slightly bolder than Polaris default (see `.claude/design/README.md`, rule 1).
- Texts that adapt per store type: noun (vehicle / phone / profile / item) and products word (parts / accessories / products). Generic texts ("Reset", "Show all {n}", "Selected" …) stay fixed in the MVP.
- No Labels, Translations, Notifications or data-retention settings in the MVP (decided).
