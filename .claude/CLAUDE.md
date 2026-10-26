# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

**SpareFit – Parts Finder** (short: SpareFit) is a public Shopify app: a "find products that fit" search (Year/Make/Model style, but with any fields) for car parts, phone accessories, beauty products or any catalogue. The app is built (milestones M1–M11 done); `README.md` has setup, commands and the local → production workflow.

- `.claude/specs/` — one spec per screen plus `data-model.md`. Describes how each screen behaves.
- `.claude/PROGRESS.md` — status, decisions and verified Shopify facts.
- `.claude/launch/` — App Store listing, privacy policy, pilot runbook, submission checklist.
- `.claude/archive/` — history, not current guidance: the original `PROPOSAL.md`, `BUILD-PLAN.md` and the `build-milestone` skill. Read only for background.

## Changing the app

For a screen change:

1. Read its spec in `.claude/specs/` (and `specs/ui-rules.md`) and look at the screen in the running app.
2. Build it as a React Router route with Polaris web components, matching the spec's wording and states.
3. Update the spec in the same change. (The UI prototype was removed 2026-10-26: the built app is the reference.)

Before using any Shopify API, extension target, scope or deep-link format, check current shopify.dev docs. Never code a Shopify API from memory.

## Claude Code tooling for this project

- **Plugin:** Shopify AI Toolkit (`shopify-ai-toolkit@claude-plugins-official`, enabled in `.claude/settings.json`). Its skills search current docs and validate code. Use the one that fits:
  - Admin GraphQL: `shopify-plugin:shopify-admin`
  - Admin UI (Polaris web components, App Bridge): `shopify-plugin:shopify-polaris-app-home`
  - Theme app extension: `shopify-plugin:shopify-liquid`
  - Metafields: `shopify-plugin:shopify-custom-data`
  - CLI and TOML: `shopify-plugin:shopify-use-shopify-cli`
  - Managed Pricing: `shopify-plugin:shopify-app-pricing`
  - App Store review: `shopify-plugin:shopify-app-store-review`
  - Anything else: `shopify-plugin:shopify-dev`
- **Workflow skills** (`.claude/skills/`):
  - `/check-spec [screen|all]`: compare a screen with its spec and the UI rules
  - `/verify-shopify [topic|file|all]`: check against current docs
  - `/pre-submit`: App Store readiness
- **Subagents** (`.claude/agents/`), all read-only reviewers:
  - `spec-reviewer`: design fidelity and rules
  - `shopify-verifier`: current APIs, scopes and targets
  - `code-reviewer`: tenant isolation, auth, robustness and tests
  Run all three before calling a larger change done.
- **Hooks** (`.claude/hooks/`, Node scripts):
  - Bash and PowerShell guard: blocks `git push`, `shopify app deploy/release`, `shopify theme push/publish`, `prisma migrate reset`, publishing, and recursive deletes of the project, as well as writes to Bilstein NL.
  - File guard: blocks `.env`, existing migrations, `package-lock.json` and Bilstein NL.
  - After each edit: prettier and eslint `--fix` (inactive until `node_modules` exists); remaining lint errors are reported back.
  - On session start: loads `.claude/PROGRESS.md`.
- **`.claude/PROGRESS.md`:** status, decisions and verified Shopify facts. Update it after every larger change or new decision.
- Quality bar per change: typecheck, lint, unit tests (`npm test`) and build pass, and `npm run test:e2e` (local Postgres) before a change is done; every Prisma query is scoped by shop; input is validated (zod); long work runs in the job queue.

## Rules (agreed with the product owner — do not undo)

- **No AI features.** Matching, column mapping and linking are rule-based.
- **Plans live in the database** (agreed 2026-10-13). There are four plan slots, edited by the super admin at `/backoffice` (`specs/backoffice.md`): price, free or paid, trial days (default 14, none on free plans), limits and features. Billing runs on the Billing API (Manual Pricing). Never hard-code plan names, prices or limits. A new plan feature is added to the registry in `app/services/plan-features.ts`, together with the code that enforces it. The backoffice is plain HTML, not Polaris, because it runs outside the Shopify admin.
- **Polaris first.** Polaris components on every screen. Only these custom, eye-catching areas: dashboard banner, setup guide, onboarding store-type cards, the locked-feature layer (`LockedSection`, added 2026-10-16), and the Results page tab's side menu (`.sp-rpside`, added 2026-10-23). Light polish everywhere else (agreed 2026-10-06, `app/styles/theme.css`): soft Sky-tinted page background, lifted top-level cards (shadow on the `s-section` host only, never Polaris' internal `--s-*-<hash>` variables), and an icon chip before section titles (`SectionTitle`; not on plan cards, onboarding or Filter data's Clean up, which has its own chip).
- **Confirm every delete** (and destructive import modes) with an `s-modal`: red primary + Cancel. Never delete on one click.
- **Notifications are toasts** (App Bridge `shopify.toast.show`); `s-banner` only for lasting states or warnings.
- **Add/edit forms open in modals**; lists are compact rows with edit and delete icons.
- **One store type per store** (Automotive, Phones and accessories, Beauty and personal care, Something else). It seeds fields and wording; everything stays editable. Never hard-code automotive words: use the store type's noun (vehicle / phone / profile / item) and products word (parts / accessories / products).
- **Single on/off control per feature.** Theme blocks are added or removed in the theme editor (Add to theme / View in editor); My Selection's on/off lives in the Theme integration table only.
- **No Labels, Translations, Notifications or data-retention settings** in the MVP.
- Narrow pages (`s-page inlineSize="base"`); section titles use the bolder heading style (see `.claude/specs/ui-rules.md`).
- **Paged tables share one standard** (`app/components/table-paging.ts` + `TableFooter`): 10 rows by default, 10 / 25 / 50 to choose from, "Showing x–y of n" left, pager centred, rows per page right. Product mapping and Filter data use it; new paged tables must too.
- **Page title inside the page** (agreed 2026-10-06): the admin title bar shows only the app name and its ⋯ menu. `s-page` gets no `heading` and no `primary-action` / `secondary-actions` buttons; the page starts with `PageHeader` (title left, actions right: secondary first, primary last). Where a spec says `s-page heading="X"` · primary **A** · secondary **B**, read it as that header.

## Working conventions

- Keep `.claude/specs/` in sync when behaviour changes; the specs must not contradict the app.
- Save deliverables as files inside `.claude/` in this project, not only as external links. The built app's code goes in the project root (or its own repo), not in `.claude/`.
- Do not push to remote branches or publish anything without being asked.
- Bilstein NL (`C:\Users\progr\Desktop\bilstein-nl`) is the source of the import engine to port; read it, don't modify it.
