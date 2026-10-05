# FitFinder — Build progress

Updated by `/build-milestone` after each milestone. The SessionStart hook loads this file into every Claude Code session, so keep it short and current.

## Milestones

| # | Milestone | Status | Notes |
| --- | --- | --- | --- |
| M1 | Scaffold + auth + data model | done (committed b9f1d28); dev-store install still to confirm | 2026-10-05. Postgres schema with all §3 tables (migrations `20261005111630_init` + `20261005112358_add_shop_last_auth_at`, applied locally); `shops` row via afterAuth + `ensureShop` in the app layout loader; uninstall stamps `uninstalled_at` only if `last_auth_at` (last token exchange/admin visit) is before `X-Shopify-Triggered-At`, so late deliveries after a reinstall are ignored; `s-app-nav` with the 7 prototype items + stub pages; template demo removed; scopes `read_products`; API 2026-10. typecheck, lint, 18 vitest tests (incl. Postgres integration: parallel installs, retried and first-late uninstall after reinstall, cascade on all 9 tables), build and `shopify app config validate` pass. Reviewers: spec PASS, Shopify verified, code blockers fixed. **Left:** install on a dev store (`npm run dev`) and confirm a `shops` row appears and the nav shows. |
| M2 | Onboarding + store types | done (committed 4d55c4f); dev-store checks pending | 2026-10-05. `/app/onboarding` (custom store-type cards, chips, Continue / Replace my setup + confirm `s-modal`, change-mode banner), presets in `app/services/store-types.ts`, `applyStoreType` in `app/models/search-config.server.ts` (race-safe: config written first in one batch transaction), layout redirects shops without config to onboarding and hides `s-app-nav` there, Search setup has **Change store type**. No sample rows (spec wins; BUILD-PLAN M2 updated). 41 vitest tests (presets, form schema, action 400/409/500/redirect, layout redirect, Postgres: create, refuse without replace, concurrent first runs, concurrent replaces, replace scoped to one shop keeping links + universal products). Reviewers: spec PASS, Shopify PASS, code blocker (race) fixed. **Left (dev store):** see M2 manual checks in Follow-ups. |
| M3 | Search setup — fields | code done, needs dev-store check | 2026-10-05. Field grid on `/app/search-setup` (name, placeholder, type, required, move, delete + confirm modal; saves on change; toasts; inputs re-sync to saved values). `app/models/search-field.server.ts`: every write locks `search_configs` FOR UPDATE first (same lock as M2 replace), renumbers positions, remaps `import_mappings`; type change converts filter data in SQL (years ⇄ "2008-2011" text; refuses non-years/reversed); delete strips the key; duplicates merged by a window-function pass; `row_hash` recomputed in SQL (`rowHashSql`). One Year range field max; 20-field cap; 110 s statement timeout. React 18 → 19 (required for Polaris field events). 74 vitest tests (21 Postgres field tests incl. concurrency, cap, year edge cases, hash freshness). Reviewers: spec (stale-input blocker fixed), Shopify PASS, code SHIP (should-fixes applied). Import history + import card come with M4. |
| M4 | Import pipeline | not started | |
| M5 | Filter data | not started | |
| M6 | Linking + Product mapping | not started | |
| M7 | Theme app extension | not started | |
| M8 | Storefront page | not started | |
| M9 | Dashboard, Settings, Plans | not started | |
| M10 | Compliance + performance | not started | |
| M11 | Pilot + submission | not started | |

## Decisions

- 2026-10-05: app scaffolded with `shopify app init --template=reactRouter --flavor=typescript` and its files moved into the project root. The template is ESM (`"type": "module"`), so Claude hooks are `.cjs`.

- 2026-10-05 stack decisions (agreed with the user):
  - **Database:** PostgreSQL + Prisma. Local: Postgres 16 in Docker, **already running** (container `fitfinder-db`, volume `fitfinder-pgdata`, database `fitfinder`; created with `docker run --name fitfinder-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=fitfinder -p 5432:5432 -v fitfinder-pgdata:/var/lib/postgresql/data -d postgres:16`; restart with `docker start fitfinder-db`). Local `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/fitfinder`. The user puts it in `.env` (Claude can't edit `.env`). Production: managed Postgres (Neon or Supabase, EU region).
  - **Job queue:** pg-boss on the same Postgres, so there is no Redis to host. Imports and re-linking run as pg-boss jobs.
  - **Dropdown cache:** Postgres distinct-values tables (no Redis).
  - **File storage:** Cloudflare R2 (S3-compatible, via `@aws-sdk/client-s3`) for import backups (last 5 per shop), error reports and exports. Local dev can use a folder behind the same interface.
  - **Hosting:** Fly.io, EU region (Amsterdam), using the template `Dockerfile`; a separate worker process runs the pg-boss jobs.
  - **Tests:** vitest for unit tests; validation with zod.
- 2026-10-05 M1: replaced the template SQLite migration with a fresh Postgres `init` (never applied anywhere). `@shopify/app-bridge-types` added to tsconfig `types` (was only pulled in by the removed demo page). `s-link rel="home"` passed via a spread because polaris-types lacks `rel`. Dev Claude permissions for npm/npx prisma/vitest/config validate live in `.claude/settings.local.json`.
- 2026-10-05 M2: onboarding is a route action (no `/api/setup`); default field placeholders "Select {label}"; replace deletes fields, filter rows and import mappings but keeps product links and universal products; zod schemas live in `.server.ts` modules to keep zod out of the client bundle (onboarding chunk 58 kB → 6 kB).
- 2026-10-05 M3: React upgraded to 19.3 (Polaris docs: controlled fields need React 19). `app/types/app-bridge-jsx.d.ts` maps `s-app-nav` into `React.JSX` until @shopify/app-bridge-types supports it (0.7.2 doesn't). Placeholders stored empty = default (M2 seeding changed to match). **`row_hash` is always computed in SQL with `rowHashSql`** (md5 of `values::text`|years|attachment); M4's importer must use it, not a JS hash. One Year range field per store (rows hold one from–to pair).
- 2026-10-05 Local dev on a store: run `npm run dev:tunnel` (scripts/dev-tunnel.mjs) in your own terminal: starts a Cloudflare quick tunnel to localhost:3000, then `shopify app dev --tunnel-url <url>:3000`; the CLI updates the app URLs (automatically_update_urls_on_dev). `TUNNEL_URL=https://… npm run dev:tunnel` uses a named tunnel instead. Plain `npm run dev` also works (the CLI starts its own cloudflared). The TOML's example.com URLs are only placeholders; the app only works on the store while dev runs.
- 2026-10-05 Theme: **Sky** (light blue) for the custom areas, tokens in `app/styles/theme.css` (`--ff-*`, loaded by the app layout). Prototype default switched to Sky.
- Build approach: one milestone per fresh Claude Code session (`/build-milestone`), committing after each milestone.

## Verified (Shopify docs)

Facts checked against shopify.dev, so they aren't re-researched. Format: `date · API version · topic: answer (URL)`.

- 2026-10-05 · App Home v1.0 · `s-app-nav`: children are `s-link`; the one with `rel="home"` sets the home route and is **hidden** from the menu (the app name in the sidebar links home). So "Dashboard" is not a visible menu item; the other 6 are. (https://shopify.dev/docs/api/app-home/v1.0/app-bridge-web-components/app-nav)
- 2026-10-05 · shopify-app-react-router v3.0.1 · `hooks.afterAuth` runs after **every token exchange**: install, reinstall and roughly hourly with expiring offline tokens (exchange when the session is within 5 min of expiry). Keep it idempotent; no one-time work there. (https://shopify.dev/docs/api/shopify-app-react-router/v3; code: `token-exchange.mjs`)
- 2026-10-05 · 2026-10 · API version: 2026-10 is the latest stable (released 2026-10-01); 2027-01 is a release candidate. TOML `webhooks.api_version` and `ApiVersion.October26` aligned. (https://shopify.dev/docs/api/usage/versioning)
- 2026-10-05 · New public apps must use expiring offline access tokens (`future.expiringOfflineAccessTokens: true`, kept). (https://shopify.dev/changelog/posts/offline-access-tokens-now-support-expiry-and-refresh)
- 2026-10-05 · Webhook headers include `X-Shopify-Triggered-At` (RFC 3339) and `X-Shopify-Event-Id`; `authenticate.webhook` returns `triggeredAt`. Used to ignore late `app/uninstalled` deliveries. (shopify.dev webhook delivery headers, via shopify-dev doc search; library: `authenticate/webhooks/types.d.ts`)
- 2026-10-05 · GDPR webhooks go in the TOML with `compliance_topics = [...]` (not `topics`); required for App Store review. (https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)
- 2026-10-05 · App Home v1.0 · `s-modal`: open with `s-button commandFor="id"`, close with `command="--hide"` or `shopify.modal.hide(id)`; buttons in `slot="primary-action"` / `slot="secondary-actions"`; sizes small, small-100, base, large, large-100. Red primary = `variant="primary" tone="critical"`. (https://shopify.dev/docs/api/app-home/v1.0/web-components/overlays/modal)
- 2026-10-05 · App Bridge · `shopify.toast.show(msg, { isError, duration, action, onAction, onDismiss })`. (https://shopify.dev/docs/api/app-home/v1.0/apis/user-interface-and-interactions/toast-api)
- 2026-10-05 · shopify-app-react-router v3 · `redirect` from `authenticate.admin` keeps shop/host/embedded params for relative URLs; works from actions (fetcher follows) and thrown from loaders. (types.d.ts; helpers/redirect.js)
- 2026-10-05 · App Home v1 · React 19 is required for controlled Polaris fields; `onChange` fires on commit (blur/Enter), `onInput` per keystroke; read `e.currentTarget.value/.checked`. s-modal async confirm: loading on the primary, hide only after success. (https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/text-field, …/modal)
- 2026-10-05 · App Home · No documented way to hide `s-app-nav`; removing the element is untested (manual check). Title-bar `s-button`s are documented with onClick/commandFor, not href. (https://shopify.dev/docs/api/app-home/v1.0/app-bridge-web-components/title-bar)

## Follow-ups

- **M3 manual checks (dev store):** edit a name/placeholder and tab out (saves; no toast); clear a name (old name comes back); set a 2nd field to Year range (error toast, select reverts); trash icon opens the modal with the right field name on the first click; Delete field closes it after success.
- **M2 manual checks (dev store):** (1) first install opens onboarding with no app menu; (2) Search setup › Change store type navigates to onboarding (title-bar button uses onClick) and the app menu disappears there; if it stays, document it in specs/onboarding.md; (3) Replace my setup shows the confirm modal and lands on the Dashboard.
- M4: field type changes / deletes rewrite all filter rows in the request (110 s statement timeout, clear error). Move to a pg-boss job with the replace purge; import batches must lock/re-check the setup (`search_configs`) so they can't write rows for deleted fields.
- M4: replacing a store type deletes all filter rows inside the request. Before imports exist that is instant; in M4 move the row purge to a pg-boss job (batched deletes), refuse a replace while an import runs, and hide old rows from the storefront during the purge (e.g. a config generation the rows carry).
- Child loaders must handle a missing search config (done for Search setup: throws the onboarding redirect); repeat in each new route. Positions are kept 0..n-1 under the config lock instead of a unique index.
- M9: Settings › Store type **Change** entry point (specs/onboarding.md).
- Shopify AI Toolkit `validate.mjs` fails locally (missing `typescript` in the plugin dir); tsc against @shopify/polaris-types is the check meanwhile.
- Tests that sit next to routes break React Router route discovery: keep route tests in `app/tests/`.

- M2: hide `s-app-nav` while onboarding (spec: no sidebar menu during onboarding); route to `/app/onboarding` when the shop has no `search_configs` row.
- M8: add theme read scope(s) after verifying asset access.
- M10: purge job for shops 30 days after `uninstalled_at`; GDPR webhooks (`compliance_topics`), `shop/redact` deletes the shop row (cascade).
- M5 (before building): per-shop GIN — `GIN (shop_id, values jsonb_path_ops)` via `btree_gin`, plus `(shop_id, year_from, year_to)`; plan cascading distinct-values queries and check with EXPLAIN on a 700k-row seed.
- M3: deleting a search field must clean its key out of `fitment_rows.values` and rehash rows (decide in M3).
- M6: `product_links` unique (shop_id, attachment) means one link per attachment; Shopify allows duplicate SKUs. Decide: first match wins, or allow several links.
- Tidy `webhooks.app.scopes_update.tsx` (template: zod check on payload, formatting).

