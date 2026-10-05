# FitFinder — Build progress

Updated by `/build-milestone` after each milestone. The SessionStart hook loads this file into every Claude Code session, so keep it short and current.

## Milestones

| # | Milestone | Status | Notes |
| --- | --- | --- | --- |
| M1 | Scaffold + auth + data model | in progress | Scaffold done 2026-10-05 (React Router template, TypeScript, linked to app client_id 7b77…bf9). typecheck, lint and build pass. Still to do: Postgres instead of SQLite, FitFinder Prisma models, shops row on install, s-app-nav, remove template demo (product/metaobject demo routes, demo_info metafield, example metaobject), trim scopes. |
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
  - **Database:** PostgreSQL + Prisma. Local: Postgres in Docker (`docker run --name fitfinder-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16`). Production: managed Postgres (Neon or Supabase, EU region).
  - **Job queue:** pg-boss on the same Postgres, so there is no Redis to host. Imports and re-linking run as pg-boss jobs.
  - **Dropdown cache:** Postgres distinct-values tables (no Redis).
  - **File storage:** Cloudflare R2 (S3-compatible, via `@aws-sdk/client-s3`) for import backups (last 5 per shop), error reports and exports. Local dev can use a folder behind the same interface.
  - **Hosting:** Fly.io, EU region (Amsterdam), using the template `Dockerfile`; a separate worker process runs the pg-boss jobs.
  - **Tests:** vitest for unit tests; validation with zod.
- Build approach: one milestone per fresh Claude Code session (`/build-milestone`), committing after each milestone.

## Verified (Shopify docs)

Facts checked against shopify.dev, so they aren't re-researched. Format: `date · API version · topic: answer (URL)`.

## Follow-ups

