# App Store submission checklist

Definitive, ordered list for submitting SpareFit. Re-checked **2026-10-06** against the live docs (fetched with `shopify doc fetch`, Shopify AI Toolkit `shopify-app-store-review` skill, plus a `shopify-verifier` and a `code-reviewer` pass over the whole app including the uncommitted UI work). Claude never deploys, releases or submits: everything marked **you** or **dev store** is yours.

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

## 0. Automated review tests (run before every submission)

`npm run test:review` builds the app and runs the review suites (it refuses a build older than the code); `npm test` includes the static half. Requirements re-fetched **2026-10-16** ([requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements), [AI self-review list](https://shopify.dev/docs/apps/launch/app-store-review/app-store-ai-self-review-requirements)).

- `app/e2e/app-review.e2e.test.ts` runs the **production build** in-process (middleware, auth, loaders, rendering, headers, error pages), with Shopify faked at the HTTP boundary.
- `app/tests/app-review-static.test.ts` reads the config, code and theme extension.
- `app/e2e/journey.e2e.test.ts` walks every feature with two stores (tenant isolation, jobs, purge).

| Req. | What reviewers check | Covered by |
| --- | --- | --- |
| 1.1.1 | Session tokens, no third-party cookies | HTTP: pages, data requests and API refuse missing/forged tokens; no `Set-Cookie`. Static: no `document.cookie`; every `app.*`/`api.*` route calls `authenticate.admin` |
| 1.2.1 | Shopify billing only | Static: no Stripe/PayPal/etc.; `appSubscriptionCreate` only in `subscription.server.ts` |
| 1.2.2 | Billing works | HTTP: Choose plan → `appSubscriptionCreate`, approval URL on the shop's admin, `returnUrl` back into the app, test charge on dev stores, real charge on a real store |
| 1.2.3 | Change plans in-app | HTTP: approve Growth → Plans shows it at once (fresh read on return); upgrade to Pro (`replacementBehavior: STANDARD`; the app's record has Pro as the one active charge); down to free (`appSubscriptionCancel`). Forcing test charges is refused in production |
| 2.1.x | No errors / broken UI | HTTP: every nav page 200 in < 2 s with no `undefined`/`NaN`/`null`/stack traces/placeholder text, also in Polaris attributes (headings, labels); friendly 404 outside and inside `/app` (inside: the app's own page with App Bridge and the menu); Shopify outage → "Something went wrong", no stack |
| 2.2.2 / 2.2.3 | Embedded, latest App Bridge | HTTP: App Bridge (CDN) is the first script, API key present, Polaris loaded, `frame-ancestors` CSP for the shop + admin (a spoofed `?shop=` never widens it). Static: `embedded = true`, no legacy `@shopify/app-bridge` package |
| 2.2.4 | GraphQL Admin API only | Static: no REST, ScriptTag or Asset API |
| 2.3.1 | No shop-domain entry | HTTP: landing page has no shop input; `/auth/login` → landing page, or Shopify's install with a valid shop |
| 2.3.2–2.3.4 | OAuth first, redirect to the app, reinstall | HTTP: no token → session-token bounce; first open → onboarding; uninstall on a paid plan → storefront stops; reinstall → app opens with its setup and no paid plan carried over |
| Tenant isolation | One store can't see or change another's data | HTTP: another store's token reads none of the rows and can't edit or delete them; writes without a token change nothing; the backoffice is behind its own sign-in |
| 3.1.1 | TLS | Static: production `application_url` / `redirect_urls` HTTPS on the app's own host, no placeholders |
| Scopes | Minimal, none protected | Static: exactly `read_products,write_app_proxy,read_themes,write_files` in both tomls; no customer/order scopes; offline tokens only; no customer fields in the schema |
| Webhooks | Uninstall + compliance, HMAC | HTTP: every topic in `shopify.app.toml` → 200 with a valid HMAC, 401 with a wrong one; `shop/redact` for an installed shop changes nothing; `scopes_update` stores the scopes. Static: compliance topics present, same in dev/prod, routes exist and verify the HMAC, API version = code's |
| App proxy | Signed requests | HTTP: signed → 200; forged or unsigned → 400 on every proxy route (options, search, results, fits); uninstalled shop → 404. Static: every proxy route goes through the signature check |
| 5.1.1–5.1.4 | Theme app extension, performance, branding | Static: theme extension with app embed + blocks; each asset < 10 KB (gzip < 5 KB), Liquid < 100 KB, scripts via the schema (deferred), non-blocking CSS, no jQuery; no "SpareFit" text shown to shoppers |

**Still manual** (needs Shopify, a store or the listing; see §2–§4): Partner Dashboard pricing (manual) and listing prices = backoffice plans; emergency contact and API contact email; protected customer data opt-out; app icon, screenshots, screencast, privacy policy URL; dev-store walk-through in Chrome incognito and Safari (includes the support chat widget); billing approve/decline/reinstall on a dev store; `shopify app webhook trigger` for the compliance topics against production; Horizon and Dawn with the embed on/off; Lighthouse impact ≤ 10 points; TLS certificate on sparefit.progryss.com.

## 1. Code (this repo)

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1.1 | 1.1.1 Session tokens, no 3rd-party cookies / localStorage for auth | pass | `app/shopify.server.ts` (shopify-app-react-router, managed install + token exchange, `expiringOfflineAccessTokens`); every `app.*`/`api.*` loader and action calls `authenticate.admin` (e.g. `app/routes/app.tsx:36`); client `fetch` gets the ID token from App Bridge. The only admin `localStorage` use (setup guide collapsed) is wrapped in try/catch and optional (`app/routes/app._index.tsx:212-226`). |
| 1.2 | 1.1.2–1.1.16 (checkout, themes download, fake data, marketplace, payments, POS, charges, shipping, product copying, agencies, refunds, lending) | pass | None of these features exist. Storefront data comes only from the merchant's own rows and products. |
| 1.3 | 1.2.1 Charges through Shopify billing | pass · **you**: pricing method | Billing API (Manual Pricing, agreed 2026-10-13: prices and trials are edited in our backoffice): `appSubscriptionCreate` / `appSubscriptionCancel` / `currentAppInstallation.activeSubscriptions` in `app/services/subscription.server.ts`, verified against 2026-10. **You:** the app needs **public distribution** (Partner Dashboard › Distribution); without it Shopify refuses `appSubscriptionCreate` ("Apps without a public distribution cannot use the Billing API"). Set and confirmed on the dev store 2026-10-15; no separate pricing-method switch was needed. Say in the reviewer notes why we use the Billing API (plan prices and trials are managed in the app's backoffice). |
| 1.4 | 1.2.2 Accept / decline / re-approve on reinstall | pass | Plans → **Choose {plan}** creates a charge → Shopify's approval page. Declining leaves the plan at "none", and the merchant can choose again. A reinstall resets the plan to "none" (Shopify cancels charges on uninstall; our records end too). Trial days already used aren't given again. |
| 1.5 | 1.2.3 Upgrade / downgrade without support | pass | Paid → paid: a new charge with `replacementBehavior: STANDARD` (Shopify defers annual → cheaper/monthly to the next cycle). Paid → free: confirm modal → `appSubscriptionCancel`. Charges show in the store's Settings › Billing. |
| 1.6 | 4.2.1 / 1.1.4 Pricing and plan features accurate | pass · **you**: keep in sync | Plan cards are built from the `plans` table: the limits and the enforced features (fits badge, fitment table, My Selection and universal products are gated by plan) plus the backoffice's extra lines. **You:** the listing's pricing (prices, trials, features) must match the backoffice plans; update the listing whenever you edit a plan. |
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
| 1.18 | TOML ready for production | **you** | `shopify app config validate --json` → `{"valid": true, "issues": []}`. Replace the placeholder `application_url = "https://example.com"` and `redirect_urls` with the production host (no "shopify"/"example" in the domain). `include_config_on_deploy` was removed on purpose: CLI 4.8.4 drops it ("no longer supported, since all apps must now include configuration on deploy"). Optionally rename `name = "sparefit"` → `SpareFit` (4.1.1). API version 2026-10 = latest stable. |
| 1.19 | 5.1.1 Theme app extensions only | pass | `extensions/sparefit-theme` (3 blocks + embed); themes are only read. `shopify theme check` → 5 files, no offenses. |
| 1.20 | 5.1.2 Widgets show without errors (editor + storefront) | **dev store** | Check on Horizon and Dawn (pilot runbook §4). |
| 1.21 | 5.1.3 Setup instructions + deep links | pass | Storefront › Theme integration: App embed switch (`activateAppId`) and **Add to theme** per block (`addAppBlockId`), `app/services/storefront/themes.ts:180-194`; Dashboard setup guide. |
| 1.22 | 5.1.4 App name branding on the storefront | pass | No "SpareFit" text, logo or "powered by" for shoppers; the only branded text (`setup_needed`) renders in the theme editor only (`request.design_mode`). |
| 1.23 | 5.1.5 Customer data back to merchant | pass (n/a) | No customer data collected; My Selection lives in the shopper's browser. |
| 1.24 | Embedded UX: page title in the title bar | **decide** (needs review) | `s-page` has no `heading`; titles are an in-page `PageHeader` (rule agreed 2026-10-06). Not an App Store requirement, but the Page/Title bar docs say "Always provide a title that describes the current page" / the title bar "helps merchants understand where they are" (https://shopify.dev/docs/api/app-home/v1.0/app-bridge-web-components/title-bar). Lowest-risk option if a reviewer comments: also pass `heading` to `s-page` (title bar shows page context) and keep the in-page header. |
| 1.25 | Loading states | **decide** (needs review) | `AppLoading` covers the whole page on every document load (≥ 400 ms) and on page changes > 300 ms. Not an App Store requirement; App Home guidance prefers scoped loading and `shopify.loading()` for page transitions (https://shopify.dev/docs/api/app-home/v1.0/apis/user-interface-and-interactions/loading-api), and Built for Shopify measures LCP/INP. Code review found no way for it to get stuck (pointer-events off while fading, 10 s CSS failsafe). Consider dropping the 400 ms minimum before applying for Built for Shopify. |
| 1.26 | Support contact in the app | done (2026-10-15) | Live support chat widget (`app/components/SupportChat.tsx`, chat.progryss.com) on every admin page; Settings › Help points to it. Check it opens on the dev store before submitting. |
| 1.27 | Quality gates | pass | typecheck (outside the in-progress `app/e2e/`), lint, vitest 378/380 with the 2 failures in `storefront.integration.test.ts` passing on re-run (DB shared with concurrent work; 12/12 alone), `config validate`, `theme check`. |

Known, low-risk follow-ups (not review blockers): uninstall webhook is ignored if our clock runs ahead of Shopify's within seconds of an admin visit (`app/models/shop.server.ts:84-97`; shop/redact catches it 48 h later); `webhooks.app.uninstalled` route has no route test; `.env.example` lacks `PORT`, `PGBOSS_SCHEMA`, `TUNNEL_URL`.

## 2. Hosting and Partner Dashboard (you), in this order

1. [ ] Deploy to the production host (Fly.io EU) with Postgres, R2 (CORS PUT from the app origin), proxy timeout ≥ 120 s, worker or `JOBS_INLINE=true` (`pilot-runbook.md` §0).
2. [ ] Env: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `DATABASE_URL`, storage vars, **`SHOPIFY_APP_HANDLE`** (= `handle` in shopify.app.toml), **`BACKOFFICE_EMAIL`, `BACKOFFICE_PASSWORD`**, **`APP_STORE_URL`, `PRIVACY_POLICY_URL`**. Never set `SHOPIFY_BILLING_TEST` in production (it is ignored there anyway).
3. [ ] `shopify.app.toml`: production `application_url` + `redirect_urls`; then `shopify app config validate` and `shopify app deploy` (config, compliance webhooks, app proxy, theme extension).
4. [ ] Pricing: the app's distribution is **Public** (done 2026-10-15; the Billing API needs it). Set the real plans in the backoffice (`/backoffice`), mark one plan **Free** if shops without a plan should get its limits, and enter the same prices, trials and features in the listing's Pricing section.
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
3. [ ] Billing: Plans → Choose Growth → Shopify's approval page shows the price and the trial → back on `/app/plans?charge=1` with Growth and the trial badge. Then switch to Pro, and back to Starter (modal; charge cancelled). Check the store admin's Settings › Billing for the app charges. Uninstall, reinstall and choose again (no second full trial). Decline a charge and choose again.
4. [ ] Compliance: `shopify app webhook trigger --topic customers/data_request --api-version 2026-10 --delivery-method http --address https://<app host>/webhooks/compliance` (and `customers/redact`, `shop/redact`) → 200 and a log line; a tampered HMAC → 401.
5. [ ] Storefront on **Horizon** and **Dawn**: embed on, Search section, Fits badge, Fitment table added through the deep links; dropdowns cascade; Show parts opens the theme search; badge and table correct; no console errors in the theme editor (5.1.2).
6. [ ] **Lighthouse impact ≤ 10 points** (best practices §4; weighted home 17 % / product 40 % / collection 43 %):
   1. Clean dev store on Horizon with real-looking products and a collection; storefront password on is fine (use the theme preview link).
   2. SpareFit embed **off**, no blocks: `npm run perf:lighthouse -- --label before --home <url> --product <url> --collection <url> --runs 3` (PageSpeed Insights, mobile; optional `PSI_API_KEY=…`).
   3. Turn the embed on, add Search section (home), Fits badge + Fitment table (product template), save.
   4. `npm run perf:lighthouse -- --label after --home <url> --product <url> --collection <url> --runs 3` → prints the weighted difference and PASS/FAIL. Results are kept in `.data/lighthouse/`. Repeat on Dawn.
7. [ ] Take the 6 screenshots (1600 × 900, no browser chrome) and record the screencast (`app-listing.md`).
8. [ ] Tick the M1–M10 dev-store checks in PROGRESS › Follow-ups.

## 4. Submit (you)

Partner Dashboard › App › Distribution › Shopify App Store › review page: complete configuration, listing, protected data, automated checks → **Submit**. Add `noreply@shopify.com` to your allowed senders; answer reviewer emails promptly (repeated unaddressed issues can suspend submissions).

## 5. Plan-page redirect: recommendation

> Written for Shopify App Pricing (before 2026-10-13). With the Billing API the same reasoning holds: shops without a plan get the free plan's limits, so there is no forced redirect.

**Keep "no forced redirect" for the submission; don't implement it now.**

- The requirement doesn't demand it. App Store 1.2.2 asks that the app "can accept, decline and request approval for charges again on reinstall" — Shopify's hosted plan page does the accepting and declining, and after a reinstall the stored plan resets to "none" until a plan is approved again. The redirect guide calls it "**A common pattern** is to redirect merchants to your plan selection page after they install your app" (https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/redirect-plan-selection-page). The App Pricing overview lists "Redirect merchants without an active subscription" as part of a typical integration (https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing#integrate-shopify-app-pricing-in-your-app), but that is aimed at apps that gate access. SpareFit has a free Starter plan and deliberately runs on Starter limits until a plan is picked (decision 2026-10-06).
- The risk: reviewers test "Initial plan approval and redirection to the plan's welcome link" (https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review#test-your-apps-billing-system). Mitigations already in place: the review notes tell the reviewer exactly where the plan approval is (Plans → Choose → approve → welcome link `/app/plans`), and the Dashboard setup guide has a "Plan" step. On the same page, Billing failures are marked "Failure requires app re-submit: **No**", so if a reviewer asks for it, it's a fix-in-review, not a rejection.
- If the reviewer asks (or you change your mind): in `app/routes/app.tsx`'s loader, after the onboarding check, when billing is connected and a **fresh, successful** read says the plan is `none`, `throw redirect(planSelectionUrl(session.shop, appHandle()), { target: "_top" })` — never on a failed read. Before that, confirm on a dev store that picking the free Starter plan gives a non-null `activeSubscription` (3.3), or merchants on Starter would be redirected forever.
