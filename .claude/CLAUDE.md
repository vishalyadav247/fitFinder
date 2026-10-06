# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

**FitFinder** (working name) is a public Shopify app: a "find products that fit" search (Year/Make/Model style, but with any fields) for car parts, phone accessories, beauty products or any catalogue. Everything about it lives in this `.claude/` folder; the app itself is built from it.

- `.claude/PROPOSAL.md` — what we build and why (scope, pricing, roadmap).
- `.claude/BUILD-PLAN.md` — how to build it: stack, repo layout, data model, flows, milestones with acceptance criteria. **Start here when coding.**
- `.claude/design/` — clickable UI prototype (open `.claude/design/index.html`, no build step).
- `.claude/specs/` — one spec per screen plus `data-model.md`. The prototype is the source of truth for screens, wording and behaviour.

The prototype is plain HTML/JS for review only; do not ship its code. Rebuild each screen as a React Router route with Polaris web components, matching its markup, wording and states.

## Building the app

Follow `.claude/BUILD-PLAN.md` milestone by milestone (M1 → M11). For each screen:

1. Read its spec in `.claude/specs/` and open the screen in the prototype.
2. Reuse the same Polaris web components and texts; the prototype's `data-act` handlers in `.claude/design/scripts/app.js` show the behaviour.
3. Check the milestone's "Done when" before moving on.

Before using any Shopify API, extension target, scope or deep-link format, check current shopify.dev docs (items marked **(verify)** in the build plan). Never code a Shopify API from memory.

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
  - `/build-milestone [M#]`: plan, verify, build, test, review, record
  - `/check-spec [screen|all]`: compare a screen with its spec and the prototype
  - `/verify-shopify [topic|file|all|plan]`: check against current docs
  - `/pre-submit`: App Store readiness
- **Subagents** (`.claude/agents/`), all read-only reviewers:
  - `spec-reviewer`: design fidelity and rules
  - `shopify-verifier`: current APIs, scopes and targets
  - `code-reviewer`: tenant isolation, auth, robustness and tests
  Run all three before calling a milestone done.
- **Hooks** (`.claude/hooks/`, Node scripts):
  - Bash and PowerShell guard: blocks `git push`, `shopify app deploy/release`, `shopify theme push/publish`, `prisma migrate reset`, publishing, and recursive deletes of the project, as well as writes to Bilstein NL.
  - File guard: blocks `.env`, existing migrations, `package-lock.json` and Bilstein NL.
  - After each edit: prettier and eslint `--fix` (inactive until `node_modules` exists); remaining lint errors are reported back.
  - On session start: loads `.claude/PROGRESS.md`.
- **`.claude/PROGRESS.md`:** milestone status, decisions and verified Shopify facts. Update it at the end of every milestone.
- Quality bar per change: typecheck, lint, unit tests (`npm test`) and build pass, and `npm run test:e2e` (local Postgres) before a milestone is done; every Prisma query is scoped by shop; input is validated (zod); long work runs in the job queue.

## Rules (agreed with the product owner — do not undo)

- **No AI features.** Matching, column mapping and linking are rule-based.
- **Polaris first.** Polaris components on every screen. Only three custom, eye-catching areas: dashboard banner, setup guide, onboarding store-type cards. Light polish everywhere else (agreed 2026-10-06, `app/styles/theme.css`): soft Sky-tinted page background, lifted top-level cards (shadow on the `s-section` host only, never Polaris' internal `--s-*-<hash>` variables), and an icon chip before section titles (`SectionTitle`; not on plan cards, onboarding or Filter data's Clean up, which has its own chip).
- **Confirm every delete** (and destructive import modes) with an `s-modal`: red primary + Cancel. Never delete on one click.
- **Notifications are toasts** (App Bridge `shopify.toast.show`); `s-banner` only for lasting states or warnings.
- **Add/edit forms open in modals**; lists are compact rows with edit and delete icons.
- **One store type per store** (Automotive, Phones and accessories, Beauty and personal care, Something else). It seeds fields and wording; everything stays editable. Never hard-code automotive words: use the store type's noun (vehicle / phone / profile / item) and products word (parts / accessories / products).
- **Single on/off control per feature.** Theme blocks are added or removed in the theme editor (Add to theme / View in editor); My Selection's on/off lives in the Theme integration table only.
- **No Labels, Translations, Notifications or data-retention settings** in the MVP.
- Narrow pages (`s-page inlineSize="base"`); section titles use the bolder heading style (see `.claude/design/README.md`).
- **Paged tables share one standard** (`app/components/table-paging.ts` + `TableFooter`): 10 rows by default, 10 / 25 / 50 to choose from, "Showing x–y of n" left, pager centred, rows per page right. Product mapping and Filter data use it; new paged tables must too.
- **Page title inside the page** (agreed 2026-10-06): the admin title bar shows only the app name and its ⋯ menu. `s-page` gets no `heading` and no `primary-action` / `secondary-actions` buttons; the page starts with `PageHeader` (title left, actions right: secondary first, primary last). Where a spec says `s-page heading="X"` · primary **A** · secondary **B**, read it as that header.

## Working conventions

- Keep `.claude/specs/` in sync when behaviour changes; the prototype and specs must not contradict the app.
- Save deliverables as files inside `.claude/` in this project, not only as external links. The built app's code goes in the project root (or its own repo), not in `.claude/`.
- Do not push to remote branches or publish anything without being asked.
- Bilstein NL (`C:\Users\progr\Desktop\bilstein-nl`) is the source of the import engine to port; read it, don't modify it.
