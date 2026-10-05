---
name: verify-shopify
description: Verify FitFinder's Shopify integration against current shopify.dev docs — GraphQL operations, scopes, webhooks, app proxy, theme app extension targets, deep links, Polaris web components, Managed Pricing — and resolve the (verify) items in BUILD-PLAN.md. Use before coding against a Shopify API, after changing one, or when the API version is bumped.
argument-hint: "[topic or file, e.g. 'theme editor deep links' | app/routes/proxy.results.ts | all]"
---

# Verify Shopify usage

Target: `$ARGUMENTS`

- **A question or topic** (e.g. "app proxy signature", "addAppBlockId deep link"): use the matching Shopify AI Toolkit skill and answer from the docs. Use `shopify-plugin:shopify-dev` for general topics or the API-specific one (see the table in `.claude/agents/shopify-verifier.md`).
  - Give the answer with doc links.
  - Record it in `.claude/PROGRESS.md` under "Verified" (date, API version, URL).
  - If it changes what BUILD-PLAN says, update BUILD-PLAN and remove its **(verify)** tag.
- **A file, folder or `all`**: launch the `shopify-verifier` subagent on those files (for `all`: `app/`, `extensions/`, `shopify.app.toml`, `prisma/schema.prisma`). Relay its findings as a list ordered by severity.
- **`plan`**: list every **(verify)** item in `.claude/BUILD-PLAN.md` and the specs, verify each one with the skills, and update the documents.

Don't change code without the user's go-ahead unless this was invoked from `/build-milestone`.
