---
name: pre-submit
description: Full pre-submission review of FitFinder before Shopify App Store submission (M10–M11) — App Store requirements, Built for Shopify thresholds, GDPR/uninstall, billing, storefront performance, plus spec, API and code reviews. Use when the user wants to submit, asks "are we ready", or finishes M10.
disable-model-invocation: true
---

# Pre-submission review

Run all of these and produce one readiness report. Don't fix anything until the user has seen the report.

1. **App Store requirements**: run the `shopify-plugin:shopify-app-store-review` skill against the codebase and follow its steps.
2. **In parallel**, launch subagents on the whole app:
   - `shopify-verifier` on `app/`, `extensions/`, `shopify.app.toml`
   - `code-reviewer` on the whole app (not just the diff)
   - `spec-reviewer` with "all screens"
3. **FitFinder-specific checks** (verify current thresholds with `shopify-plugin:shopify-dev`):
   - Uninstall and GDPR:
     - `app/uninstalled` stops proxy serving and schedules the 30-day purge
     - the 3 GDPR webhooks respond with 200 and `shop/redact` purges all shop data
     - this is covered by tests
   - Billing: Managed Pricing plans match `.claude/PROPOSAL.md` (Starter free; Growth $29/$290; Pro $99/$990); limits are enforced server-side; downgrade behaviour matches `specs/plans.md`.
   - Storefront performance:
     - theme extension JS and CSS sizes are within limits, and scripts are deferred
     - no jQuery and no render-blocking work
     - Lighthouse impact is measured on Dawn (ask the user to run it if no browser is available)
   - Theme compatibility: blocks work on Dawn and one non-Dawn theme; the app embed can be turned off cleanly; `[fitfinder-table]` falls back gracefully.
   - Listing assets: privacy policy URL, support contact, screenshots, app icon and demo store. List anything missing; you can't create these on the merchant's behalf.
   - Run `shopify app config validate --json` and `shopify theme check`; check that scopes are minimal.
4. **Report**:

   | Area | Status | Blockers | Notes |
   | --- | --- | --- | --- |

   Finish with a **Go / No-go** and an ordered fix list.

Never run `shopify app deploy` or `release`, and never submit anything. The user does that.
