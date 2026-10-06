# App Store submission checklist

Definitive, ordered list for submitting FitFinder. Re-checked **2026-10-06** against the live docs (fetched with `shopify doc fetch`, Shopify AI Toolkit `shopify-app-store-review` skill, plus a `shopify-verifier` and a `code-reviewer` pass over the whole app including the uncommitted UI work). Claude never deploys, releases or submits: everything marked **you** or **dev store** is yours.

Sources:
[App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements) ·
[AI self-review list](https://shopify.dev/docs/apps/launch/app-store-review/app-store-ai-self-review-requirements) ·
[Best practices](https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices) ·
[Pass app review](https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review) ·
[Submit for review](https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review) ·
[Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing) ·
[Redirect to the plan selection page](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/redirect-plan-selection-page) ·
[Storefront performance](https://shopify.dev/docs/apps/build/performance/storefront)

Status: **pass** (checked in code) · **fixed** (fixed on 2026-10-06) · **you** (account / Partner Dashboard / hosting) · **dev store** (needs a store to verify) · **decide** (product owner)

**AI self-review result (code-checkable requirements):** 0 likely failing after today's fixes · 3 need review (title bar, loading overlay, plan redirect — below) · groups skipped: 5.2 Payment, 5.4 Purchase option, 5.6 Checkout, 5.7 Sales channel, 5.8 Post purchase (no such extensions); 5.3, 5.5, 5.9, 5.10 are opt-in and don't apply.

## 1. Code (this repo)

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1.1 | 1.1.1 Session tokens, no 3rd-party cookies / localStorage for auth | pass | `app/shopify.server.ts` (shopify-app-react-router, managed install + token exchange, `expiringOfflineAccessTokens`); every `app.*`/`api.*` loader and action calls `authenticate.admin` (e.g. `app/routes/app.tsx:36`); client `fetch` gets the ID token from App Bridge. The only admin `localStorage` use (setup guide collapsed) is wrapped in try/catch and optional (`app/routes/app._index.tsx:212-226`). |
| 1.2 | 1.1.2–1.1.16 (checkout, themes download, fake data, marketplace, payments, POS, charges, shipping, product copying, agencies, refunds, lending) | pass | None of these features exist. Storefront data comes only from the merchant's own rows and products. |
| 1.3 | 1.2.1 Shopify App Pricing | pass | No `appSubscriptionCreate` / `billing.request`; plan read from the Partner API `activeSubscription` (`app/services/billing.server.ts`), plan page `admin.shopify.com/store/{store}/charges/{handle}/pricing_plans` opened with `_top` (`app/services/billing.ts:93`, `app/routes/app.plans.tsx:78`). |
| 1.4 | 1.2.2 Accept / decline / re-approve on reinstall | pass (see §5) | Approval and decline happen on Shopify's hosted page; reinstall resets the stored plan to "none" (`upsertShopOnInstall`, `app/models/shop.server.ts:30`) and the next Plans visit reads it fresh. No forced redirect — recommendation in §5. |
| 1.5 | 1.2.3 Upgrade / downgrade without support | pass · **you**: env | Plans cards → Shopify's plan page. Needs the Partner env vars in production, otherwise every plan button is disabled with "Plans can't be changed here yet" (`app/routes/app.plans.tsx:90`) — a sure billing rejection. |
| 1.6 | 4.2.1 / 1.1.4 Pricing and plan features accurate | **fixed** · **decide** | Pro card listed "Scheduled imports from a supplier feed" and "Search analytics", which don't exist (post-launch roadmap). Removed from `app/services/billing.ts` `PLANS`, `specs/plans.md` and the prototype `design/scripts/screens/plans.js`. **Decide:** the Growth card lists the fitment table, My Selection, universal products and 5 import backups as Growth features, but feature limits aren't enforced (decision 2026-10-06), so Starter has them too. Reviewers test "access to the correct plan features": either enforce them, or rewrite the cards as limits only (e.g. Starter "All storefront blocks · CSV import"). Keep the listing's pricing identical. |
| 1.7 | 2.1.1–2.1.3 No web error pages (404/500) | **fixed** | Unexpected loader errors (e.g. a DB timeout on Product mapping) were re-thrown past `boundary.error` to React Router's bare "Unexpected Application Error" page. Now the app layout shows a Polaris page with a critical banner (`app/routes/app.tsx` `ErrorBoundary`), and `app/root.tsx` has a last-resort boundary ("Page not found" / "Something went wrong"). Thrown Shopify responses still go through `boundary.error`. |
| 1.8 | 2.2.1 Uses Shopify APIs | pass | Admin GraphQL (catalog, themes, files, metafields), app proxy, theme app extension. |
| 1.9 | 2.2.2 Consistent embedded experience | pass | `embedded = true`; everything is inside the admin; theme editor opens in a new tab via deep links. |
| 1.10 | 2.2.3 Latest App Bridge, script first | pass | `AppProvider` renders `app-bridge.js` then `polaris.js` (`app/routes/app.tsx`); `app/root.tsx` has no head scripts and `<Scripts/>` at the end of body. Same as Shopify's template. |
| 1.11 | 2.2.4 GraphQL only | pass | No `/admin/api/*.json`, no REST resources, no ScriptTag / Asset writes (verifier grep). All Admin operations validated against 2026-10. |
| 1.12 | 2.2.5–2.2.9 Admin/Sidekick extensions, Max modal | pass (n/a) | No admin extensions, no Max modal. |
| 1.13 | 2.3.1 No shop-domain entry | pass | Landing page `app/routes/_index/route.tsx` has no form (fixed in M11). |
| 1.14 | 2.3.2–2.3.4 OAuth first, redirect to UI, reinstall | pass · **dev store** | Shopify managed install (no `use_legacy_install_flow`); layout loader authenticates before anything renders, sends new shops to onboarding; `upsertShopOnInstall` + `ensureShop` handle reinstall (tested in `shop.server.integration.test.ts`). Verify install + reinstall on a dev store. |
| 1.15 | 3.1.1 TLS | **you** | Fly.io serves HTTPS; set the production URL (1.18). |
| 1.16 | 3.2 Minimal scopes | pass | `read_products` (catalog/linking, product webhooks), `write_app_proxy` (`[app_proxy]`), `read_themes` (theme status, `app/services/storefront/themes.server.ts`), `write_files` (My Selection icon, `icon-upload.server.ts`). No protected or sensitive scopes. `.env.example` `SCOPES` **fixed** to match. |
| 1.17 | Compliance webhooks + uninstall | pass · **dev store** | `compliance_topics` in `shopify.app.toml:25-28`; HMAC over raw body, 401 on mismatch, 200 otherwise (`app/services/webhook-verify.server.ts`, tests `compliance-webhook.test.ts`, `webhook-verify.test.ts`); uninstall stops the proxy (`query.server.ts:59`), daily purge after 30 days (`purge.server.ts`, `purge.integration.test.ts`). `app/scopes_update` **fixed**: `updateMany` + zod payload check, so a retried delivery after an uninstall no longer 500s forever (`webhooks.app.scopes_update.tsx`). |
| 1.18 | TOML ready for production | **you** | `shopify app config validate --json` → `{"valid": true, "issues": []}`. Replace the placeholder `application_url = "https://example.com"` and `redirect_urls` with the production host (no "shopify"/"example" in the domain). `include_config_on_deploy` was removed on purpose: CLI 4.8.4 drops it ("no longer supported, since all apps must now include configuration on deploy"). Optionally rename `name = "fitFinder"` → `FitFinder` (4.1.1). API version 2026-10 = latest stable. |
| 1.19 | 5.1.1 Theme app extensions only | pass | `extensions/fitfinder-theme` (3 blocks + embed); themes are only read. `shopify theme check` → 5 files, no offenses. |
| 1.20 | 5.1.2 Widgets show without errors (editor + storefront) | **dev store** | Check on Horizon and Dawn (pilot runbook §4). |
| 1.21 | 5.1.3 Setup instructions + deep links | pass | Storefront › Theme integration: App embed switch (`activateAppId`) and **Add to theme** per block (`addAppBlockId`), `app/services/storefront/themes.ts:180-194`; Dashboard setup guide. |
| 1.22 | 5.1.4 App name branding on the storefront | pass | No "FitFinder" text, logo or "powered by" for shoppers; the only branded text (`setup_needed`) renders in the theme editor only (`request.design_mode`). |
| 1.23 | 5.1.5 Customer data back to merchant | pass (n/a) | No customer data collected; My Selection lives in the shopper's browser. |
| 1.24 | Embedded UX: page title in the title bar | **decide** (needs review) | `s-page` has no `heading`; titles are an in-page `PageHeader` (rule agreed 2026-10-06). Not an App Store requirement, but the Page/Title bar docs say "Always provide a title that describes the current page" / the title bar "helps merchants understand where they are" (https://shopify.dev/docs/api/app-home/v1.0/app-bridge-web-components/title-bar). Lowest-risk option if a reviewer comments: also pass `heading` to `s-page` (title bar shows page context) and keep the in-page header. |
| 1.25 | Loading states | **decide** (needs review) | `AppLoading` covers the whole page on every document load (≥ 400 ms) and on page changes > 300 ms. Not an App Store requirement; App Home guidance prefers scoped loading and `shopify.loading()` for page transitions (https://shopify.dev/docs/api/app-home/v1.0/apis/user-interface-and-interactions/loading-api), and Built for Shopify measures LCP/INP. Code review found no way for it to get stuck (pointer-events off while fading, 10 s CSS failsafe). Consider dropping the 400 ms minimum before applying for Built for Shopify. |
| 1.26 | Support contact in the app | **you**: env | Settings › Help buttons are disabled until `SUPPORT_EMAIL` and `HELP_CENTER_URL` are set (`app/routes/app.settings.tsx:21-22`). Set both in production. |
| 1.27 | Quality gates | pass | typecheck (outside the in-progress `app/e2e/`), lint, vitest 378/380 with the 2 failures in `storefront.integration.test.ts` passing on re-run (DB shared with concurrent work; 12/12 alone), `config validate`, `theme check`. |

Known, low-risk follow-ups (not review blockers): uninstall webhook is ignored if our clock runs ahead of Shopify's within seconds of an admin visit (`app/models/shop.server.ts:84-97`; shop/redact catches it 48 h later); `webhooks.app.uninstalled` route has no route test; `.env.example` lacks `PORT`, `PGBOSS_SCHEMA`, `TUNNEL_URL`.

## 2. Hosting and Partner Dashboard (you), in this order

1. [ ] Deploy to the production host (Fly.io EU) with Postgres, R2 (CORS PUT from the app origin), proxy timeout ≥ 120 s, worker or `JOBS_INLINE=true` (`pilot-runbook.md` §0).
2. [ ] Env: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `DATABASE_URL`, storage vars, **`SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_ACCESS_TOKEN` (Partner API client with "Manage apps"), `SHOPIFY_APP_GID`, `SHOPIFY_APP_HANDLE`**, **`SUPPORT_EMAIL`, `HELP_CENTER_URL`**.
3. [ ] `shopify.app.toml`: production `application_url` + `redirect_urls`; then `shopify app config validate` and `shopify app deploy` (config, compliance webhooks, app proxy, theme extension).
4. [ ] Shopify App Pricing: plans `starter` (free), `growth` ($29 / $290), `pro` ($99 / $990), 14-day trials on paid plans, monthly + yearly, welcome link `/app/plans` on every plan, paid plans "free for partners and developers". Feature lists = the in-app cards (after the 1.6 decision).
5. [ ] App icon 1200 × 1200 PNG/JPEG (no text, no Shopify marks, no price).
6. [ ] API contact email without the word "Shopify"; **emergency developer contact** (email + phone) (4.5.6).
7. [ ] Protected customer data: **opt out** (none used).
8. [ ] Listing from `app-listing.md`: name, subtitle, intro (98/100), details (466/500), features (≤ 80 each), feature image, 3–6 screenshots, demo store URL, privacy policy URL, support email + help URL, pricing, "Merchant must have online store", English only.
9. [ ] Privacy policy (`privacy-policy.md`) filled in and published on a public page.
10. [ ] Review form: testing instructions from `app-listing.md` › Review notes, **"no test credentials needed"** stated explicitly (4.5.4), `reviewer-sample.csv` attached or linked, **demo screencast** link (English, step by step; 4.5.3).
11. [ ] Run the automated checks on the App Store review page; all must pass before Submit.

## 3. Dev-store evidence before you submit

1. [ ] Install from the Dev Dashboard → OAuth → onboarding; uninstall → reinstall → app opens again without errors (2.3.x).
2. [ ] Open every page in **Chrome incognito** (third-party cookies blocked) and Safari: no 404/500, no console errors, toasts and modals work (1.1.1, 2.1.x).
3. [ ] Billing (pass-app-review "Shopify App Pricing"): Plans → Choose Growth → approve on Shopify's page → lands on `/app/plans?plan_handle=…` with Growth + trial badge; switch to Pro, back to Starter; check Settings › Billing › app charges in the store admin; **record whether choosing the free Starter plan gives a non-null `activeSubscription`** (affects §5).
4. [ ] Compliance: `shopify app webhook trigger --topic customers/data_request --api-version 2026-10 --delivery-method http --address https://<app host>/webhooks/compliance` (and `customers/redact`, `shop/redact`) → 200 and a log line; a tampered HMAC → 401.
5. [ ] Storefront on **Horizon** and **Dawn**: embed on, Search section, Fits badge, Fitment table added through the deep links; dropdowns cascade; Show parts opens the theme search; badge and table correct; no console errors in the theme editor (5.1.2).
6. [ ] **Lighthouse impact ≤ 10 points** (best practices §4; weighted home 17 % / product 40 % / collection 43 %):
   1. Clean dev store on Horizon with real-looking products and a collection; storefront password on is fine (use the theme preview link).
   2. FitFinder embed **off**, no blocks: `npm run perf:lighthouse -- --label before --home <url> --product <url> --collection <url> --runs 3` (PageSpeed Insights, mobile; optional `PSI_API_KEY=…`).
   3. Turn the embed on, add Search section (home), Fits badge + Fitment table (product template), save.
   4. `npm run perf:lighthouse -- --label after --home <url> --product <url> --collection <url> --runs 3` → prints the weighted difference and PASS/FAIL. Results are kept in `.data/lighthouse/`. Repeat on Dawn.
7. [ ] Take the 6 screenshots (1600 × 900, no browser chrome) and record the screencast (`app-listing.md`).
8. [ ] Tick the M1–M10 dev-store checks in PROGRESS › Follow-ups.

## 4. Submit (you)

Partner Dashboard › App › Distribution › Shopify App Store › review page: complete configuration, listing, protected data, automated checks → **Submit**. Add `noreply@shopify.com` to your allowed senders; answer reviewer emails promptly (repeated unaddressed issues can suspend submissions).

## 5. Plan-page redirect: recommendation

**Keep "no forced redirect" for the submission; don't implement it now.**

- The requirement doesn't demand it. App Store 1.2.2 asks that the app "can accept, decline and request approval for charges again on reinstall" — Shopify's hosted plan page does the accepting and declining, and after a reinstall the stored plan resets to "none" until a plan is approved again. The redirect guide calls it "**A common pattern** is to redirect merchants to your plan selection page after they install your app" (https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/redirect-plan-selection-page). The App Pricing overview lists "Redirect merchants without an active subscription" as part of a typical integration (https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing#integrate-shopify-app-pricing-in-your-app), but that is aimed at apps that gate access. FitFinder has a free Starter plan and deliberately runs on Starter limits until a plan is picked (decision 2026-10-06).
- The risk: reviewers test "Initial plan approval and redirection to the plan's welcome link" (https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review#test-your-apps-billing-system). Mitigations already in place: the review notes tell the reviewer exactly where the plan approval is (Plans → Choose → approve → welcome link `/app/plans`), and the Dashboard setup guide has a "Plan" step. On the same page, Billing failures are marked "Failure requires app re-submit: **No**", so if a reviewer asks for it, it's a fix-in-review, not a rejection.
- If the reviewer asks (or you change your mind): in `app/routes/app.tsx`'s loader, after the onboarding check, when billing is connected and a **fresh, successful** read says the plan is `none`, `throw redirect(planSelectionUrl(session.shop, appHandle()), { target: "_top" })` — never on a failed read. Before that, confirm on a dev store that picking the free Starter plan gives a non-null `activeSubscription` (3.3), or merchants on Starter would be redirected forever.
