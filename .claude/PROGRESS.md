# FitFinder — Build progress

Updated by `/build-milestone` after each milestone. The SessionStart hook loads this file into every Claude Code session, so keep it short and current.

## Milestones

| # | Milestone | Status | Notes |
| --- | --- | --- | --- |
| M1 | Scaffold + auth + data model | code done, needs dev-store check | 2026-10-05. Postgres schema with all §3 tables (migrations `20261005111630_init` + `20261005112358_add_shop_last_auth_at`, applied locally); `shops` row via afterAuth + `ensureShop` in the app layout loader; uninstall stamps `uninstalled_at` only if `last_auth_at` (last token exchange/admin visit) is before `X-Shopify-Triggered-At`, so late deliveries after a reinstall are ignored; `s-app-nav` with the 7 prototype items + stub pages; template demo removed; scopes `read_products`; API 2026-10. typecheck, lint, 18 vitest tests (incl. Postgres integration: parallel installs, retried and first-late uninstall after reinstall, cascade on all 9 tables), build and `shopify app config validate` pass. Reviewers: spec PASS, Shopify verified, code blockers fixed. **Left:** install on a dev store (`npm run dev`) and confirm a `shops` row appears and the nav shows. |
| M2 | Onboarding + store types | not started | |
| M3 | Search setup — fields | not started | |
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
- Build approach: one milestone per fresh Claude Code session (`/build-milestone`), committing after each milestone.

## Verified (Shopify docs)

Facts checked against shopify.dev, so they aren't re-researched. Format: `date · API version · topic: answer (URL)`.

- 2026-10-05 · App Home v1.0 · `s-app-nav`: children are `s-link`; the one with `rel="home"` sets the home route and is **hidden** from the menu (the app name in the sidebar links home). So "Dashboard" is not a visible menu item; the other 6 are. (https://shopify.dev/docs/api/app-home/v1.0/app-bridge-web-components/app-nav)
- 2026-10-05 · shopify-app-react-router v3.0.1 · `hooks.afterAuth` runs after **every token exchange**: install, reinstall and roughly hourly with expiring offline tokens (exchange when the session is within 5 min of expiry). Keep it idempotent; no one-time work there. (https://shopify.dev/docs/api/shopify-app-react-router/v3; code: `token-exchange.mjs`)
- 2026-10-05 · 2026-10 · API version: 2026-10 is the latest stable (released 2026-10-01); 2027-01 is a release candidate. TOML `webhooks.api_version` and `ApiVersion.October26` aligned. (https://shopify.dev/docs/api/usage/versioning)
- 2026-10-05 · New public apps must use expiring offline access tokens (`future.expiringOfflineAccessTokens: true`, kept). (https://shopify.dev/changelog/posts/offline-access-tokens-now-support-expiry-and-refresh)
- 2026-10-05 · Webhook headers include `X-Shopify-Triggered-At` (RFC 3339) and `X-Shopify-Event-Id`; `authenticate.webhook` returns `triggeredAt`. Used to ignore late `app/uninstalled` deliveries. (shopify.dev webhook delivery headers, via shopify-dev doc search; library: `authenticate/webhooks/types.d.ts`)
- 2026-10-05 · GDPR webhooks go in the TOML with `compliance_topics = [...]` (not `topics`); required for App Store review. (https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)

## Follow-ups

- M2: hide `s-app-nav` while onboarding (spec: no sidebar menu during onboarding); route to `/app/onboarding` when the shop has no `search_configs` row.
- M8: add theme read scope(s) after verifying asset access.
- M10: purge job for shops 30 days after `uninstalled_at`; GDPR webhooks (`compliance_topics`), `shop/redact` deletes the shop row (cascade).
- M5 (before building): per-shop GIN — `GIN (shop_id, values jsonb_path_ops)` via `btree_gin`, plus `(shop_id, year_from, year_to)`; plan cascading distinct-values queries and check with EXPLAIN on a 700k-row seed.
- M3: deleting a search field must clean its key out of `fitment_rows.values` and rehash rows (decide in M3).
- M6: `product_links` unique (shop_id, attachment) means one link per attachment; Shopify allows duplicate SKUs. Decide: first match wins, or allow several links.
- Tidy `webhooks.app.scopes_update.tsx` (template: zod check on payload, formatting).

