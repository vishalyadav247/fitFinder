---
name: build-milestone
description: Build one FitFinder milestone (M1–M11 from .claude/BUILD-PLAN.md) end to end — plan from the specs and prototype, verify Shopify APIs against current docs, implement, test, review with the project subagents, and record progress. Use when the user says "build M3", "next milestone", "continue the build", etc.
argument-hint: "[M1..M11 — omit to continue the next unfinished milestone]"
---

# Build a milestone

Milestone requested: `$ARGUMENTS` (if empty, use the first milestone not marked done in `.claude/PROGRESS.md`; if that file is missing, it's M1).

## 1. Load context (don't skip)

1. Read `.claude/CLAUDE.md` (rules), the milestone's row in `.claude/BUILD-PLAN.md` §5 ("Done when") and the sections it depends on (§2 layout, §3 data model, §4 flows).
2. Read every spec in `.claude/specs/` that the milestone touches, plus the matching prototype screen files in `.claude/design/scripts/screens/` and the `data-act` handlers for those screens in `.claude/design/scripts/app.js`. For texts and per-store-type wording, read `.claude/design/scripts/data/store-types.js`.
3. Read `.claude/PROGRESS.md` for decisions and leftovers from earlier milestones.

## 2. Plan

Write a short plan before coding:
- files to create or change (follow the layout in BUILD-PLAN §2)
- Prisma changes
- Shopify APIs, scopes, extension targets
- tests to add
- which "Done when" criteria each step satisfies

List every **(verify)** item and every Shopify API the milestone uses. If the spec and build plan disagree, say so and follow the rule in BUILD-PLAN's intro (the spec wins for UI, the plan wins for architecture).

## 3. Verify Shopify APIs first

Before writing code that calls Shopify, use the Shopify AI Toolkit skills: search the docs, then validate.
- Admin GraphQL: `shopify-plugin:shopify-admin`
- Admin UI: `shopify-plugin:shopify-polaris-app-home`
- Theme extension: `shopify-plugin:shopify-liquid`
- Metafields: `shopify-plugin:shopify-custom-data`
- CLI and TOML: `shopify-plugin:shopify-use-shopify-cli`
- Billing: `shopify-plugin:shopify-app-pricing`
- Other: `shopify-plugin:shopify-dev`

Write each confirmed answer into `.claude/PROGRESS.md` under "Verified" with the doc URL, so it isn't re-researched.

## 4. Implement

- Work in small steps; keep the app runnable after each one.
- Scaffold with `shopify app init` (React Router template) only in M1. Use `shopify app generate extension` for extensions.
- Match the prototype: same Polaris web components, same texts, same states.
- Respect every rule in CLAUDE.md.
- Server side: scope every query by shop; validate input with zod; run long work in the job queue.
- Add unit tests (vitest) for services and pure logic as you go.
- Prisma: change `prisma/schema.prisma`, then `npx prisma migrate dev --name <change>`. Never edit an existing migration.

The PostToolUse hook runs prettier and eslint on every file you edit. Fix any lint errors it reports right away.

## 5. Check

Run what exists in `package.json`, usually `npm run typecheck`, `npm run lint`, `npx vitest run` and `npm run build`. Then:
- Run `shopify app config validate --json` if the TOML changed.
- Run `shopify theme check` on `extensions/` if Liquid changed.

Everything must pass. Fix failures; don't silence them.

## 6. Review (in parallel)

Launch these subagents together, each scoped to this milestone's files:
- `spec-reviewer`: matches specs, prototype and rules
- `shopify-verifier`: current APIs, scopes, targets
- `code-reviewer`: tenant isolation, auth, robustness, tests

Fix every blocker. Re-run step 5. Re-run a reviewer only if its blockers needed non-trivial changes.

## 7. Done when

Go through the milestone's "Done when" criteria one by one, with evidence for each (test name, command output, or a manual step the user must do on a dev store, such as installing the app or opening the theme editor). Don't claim a criterion you couldn't check; list it as "needs manual check".

## 8. Record

Update `.claude/PROGRESS.md`:
- mark the milestone done, or partly done with what's left
- decisions made, verified API facts, follow-ups

If behaviour changed from the spec, update the spec in the same change.

Then show the user a summary and a proposed commit message. Commit only if they ask. Never push.
