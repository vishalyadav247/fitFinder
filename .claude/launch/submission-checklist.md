# App Store submission checklist (M11)

Run `/pre-submit` for the full readiness report. This list is what must exist before you press Submit in the Partner Dashboard. Claude never deploys, releases or submits.

## Code (in this repo)

- [x] Session-token auth, embedded, App Bridge via `@shopify/shopify-app-react-router` (req. 1.1.1, 2.2.3)
- [x] GraphQL Admin API only; no REST, no Asset/ScriptTag writes (2.2.4, 5.1.1)
- [x] No shop-domain field anywhere; the app URL outside the admin shows a plain page (2.3.1, fixed in M11)
- [x] Managed install + token exchange; reinstall handled (`upsertShopOnInstall`) (2.3.2–2.3.4)
- [x] Shopify App Pricing; plan changes on Shopify's hosted page (1.2.1, 1.2.3)
- [x] Compliance webhooks with HMAC 401; purge 30 days after uninstall (privacy)
- [x] Theme app extension: blocks + embed, deep links and in-app instructions (5.1.1, 5.1.3)
- [x] Scopes minimal: `read_products, write_app_proxy, read_themes, write_files`
- [ ] **Decide:** redirect shops without a plan to Shopify's plan page on first open? (App Pricing guide pattern; review tests "initial plan approval"; currently no redirect — PROGRESS › M9 open question)

## Partner Dashboard (you)

- [ ] App URL / redirect URLs on the production host (no "shopify" or "example" in domains)
- [ ] `shopify app deploy` of the final config and extension version
- [ ] Plans in Shopify App Pricing (starter / growth / pro; monthly + yearly; 14-day trials; welcome link `/app/plans`)
- [ ] App icon 1200 × 1200
- [ ] Emergency developer contact (email + phone)
- [ ] Protected customer data: opt out (no customer data used)
- [ ] Listing: name, introduction, details, features, screenshots, feature image, demo store, privacy policy URL, support contact (`app-listing.md`)
- [ ] Review notes and a sample CSV for the reviewer

## Evidence (from the pilot)

- [ ] Bilstein NL data live on the staging store (`pilot-runbook.md`)
- [ ] Lighthouse impact PASS on Horizon (≤ 10 points)
- [ ] Billing upgrade / downgrade on a dev store
- [ ] Compliance webhooks triggered with the CLI
- [ ] Dev-store checks from M1–M10 in PROGRESS › Follow-ups ticked off
