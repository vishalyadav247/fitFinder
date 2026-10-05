# FitFinder — Shopify App Development Proposal

Oct 5, 2026 · replaces the Oct 1 version

We ask for approval to build FitFinder (working name): a public Shopify app that lets shoppers find **products that fit what they own**: car parts that fit their vehicle, accessories that fit their phone, beauty products that suit their profile, or any catalogue where "does this fit?" matters. It combines the feature set that made EasySearch YMM a 4.9★ leader with the high-volume import engine already proven on the Bilstein NL store (727k fitment rows), and fixes the weaknesses EasySearch's own reviewers name.

A clickable prototype of the full admin app is ready in `.claude/design/` (open `.claude/design/index.html`); every screen has a spec in `.claude/specs/`. This proposal describes what the prototype shows.

## Market

Fitment search apps are a proven, paid category. Merchants pay $19 to $250+ a month, and the leader still has fixable weaknesses.

| App | Starting price | Rating | Positioning |
| --- | --- | --- | --- |
| [EasySearch YMM](https://apps.shopify.com/easysearch) (NexusMedia) | $19/mo Basic, $75/mo Premium | 4.9★, 169 reviews | Small and mid-size auto parts stores; Built for Shopify; launched 2016 |
| Convermax | $250/mo | n/a | Enterprise catalogs with millions of SKUs |
| PartFinder | $49/mo | 5.0★, 15 reviews | Mid-market |
| Friends2a YMM PartFinder | Free | n/a | Entry level |
| VFitz | $0.97/mo | n/a | Budget dropdown filter |

What EasySearch merchants complain about in 1–3★ reviews:

- CSV import overwrites existing data; you cannot add or update rows incrementally.
- Export comes out in a format merchants cannot easily edit and re-upload.
- Some searches return unrelated vehicles or parts.
- Free-trial and billing activation confused new users.
- Setup documentation is hard to follow without support.
- Automotive only and fixed to Year / Make / Model. My Garage and the fitment table are locked behind the $75 plan.

## What we build

**One app for any "does it fit?" catalogue.** At onboarding the merchant picks one store type. It only sets the starting search fields and wording; every field stays editable.

| Store type | Default search fields | Shopper word | Products word |
| --- | --- | --- | --- |
| Automotive (car, motorcycle or truck parts) | Make › Year › Model | vehicle | parts |
| Phones and accessories | Brand › Series › Model | phone | accessories |
| Beauty and personal care | Brand › Product type › Gender | profile | products |
| Something else | Brand › Model (merchant defines the rest) | item | products |

**Admin app (embedded in Shopify admin, plain Polaris):**

| Page | What the merchant does there |
| --- | --- |
| Onboarding | Picks the store type; sample data gives a working demo in minutes |
| Dashboard | Banner, 5-step setup guide (Search setup → Import → Link products → Go live → Plan), overview cards |
| Search setup | Edits the dropdown fields in place (name, placeholder, Dropdown or Year range, required, order). Imports a CSV in 3 steps (Upload › Map columns › Review): a preview of the file with a "Map column" dropdown above each column, mapping remembered for next time. Import history keeps the last 5 files as downloadable backups |
| Filter data | Searches, adds, edits (popup) and deletes rows (always confirmed); exports all / selected / unlinked rows in the import format; removes duplicates |
| Storefront | Picks the theme, turns on the app embed, adds the blocks (deep link to the theme editor). Tabs: Search widget · Fits badge · Fitment table · My Selection, each with settings and a live preview |
| Product mapping | Links unmatched rows to products, lists products without filter data (add a row or mark as universal), manages universal products |
| Settings | Store type, a plain explanation of the data we keep, help |
| Plans | Current plan with usage meters, monthly / yearly, upgrade through Shopify |

**On the shopper's store (theme app extension):**

| Feature | Shopify type | Where |
| --- | --- | --- |
| Search section | Section (app block) | Any page: home, collection, product … |
| Fits badge | App block | Product page, in the product info: before a selection / fits / doesn't fit (+ link to parts that fit) |
| Fitment table | App block, **or** inside the theme's own product tabs via the code `[fitfinder-table]` | Product page; tabs on desktop, accordion on mobile when the theme does that |
| My Selection | App embed (floating) | Every page: a fixed tab on the window edge with the shopper's current selection; panel to switch, add or remove saved selections |

Results use the store's own collection pages, so the theme renders product cards, prices, currency, stock and the cart.

## How we win

| EasySearch weakness | FitFinder answer |
| --- | --- |
| Re-upload overwrites all data | Import modes: add and update (default), replace all, delete the listed rows, each with a review step (destructive ones confirmed) |
| Export can't be edited and re-imported | Export uses exactly the import format; last 5 imported files kept as backups |
| Fixed Year / Make / Model, automotive only | Any fields, any order, four store types including "Something else" |
| Unrelated results reported | Exact-match filtering on the server; the fitment table shows why a part matched |
| Trial and billing confusion | Shopify Managed Pricing handles the trial and plan changes |
| Hard setup | Store type presets, sample data, a 5-step setup guide, column mapping that remembers, and "Add to theme" deep links |
| My Garage only on the $75 plan | My Selection in the $29 plan |
| Fitment table only as a separate block | Can live inside the merchant's existing Description / Specifications tabs |

We also start with a reference customer: Bilstein NL can be the first install, case study and review.

## Starting point

The Bilstein NL finder already solves the hardest backend problem, importing and querying 727k fitment rows quickly. Its auth, storefront and single-store design are rebuilt for a public app.

| Area | Bilstein NL today | Public app |
| --- | --- | --- |
| CSV import | Streams 50k-row batches, progress, gzip, aborts cleanly | **Reuse**, plus column mapping, add/update/replace/delete modes, review step, backups |
| Lookup queries | Compound index, Redis cache | **Reuse** the pattern, scoped per shop and per configurable field |
| Fitment data | Fixed Bilstein columns | **Rebuild** as configurable fields (Dropdown or Year range) |
| Product link | Part no. must equal the variant SKU | **Rebuild**: attachment = SKU, product link or collection link; unmatched list; universal products |
| Product data copy | MongoDB copy kept by webhooks | **Drop**: Shopify renders prices, currency and stock |
| Storefront | 1,535-line jQuery script in the theme | **Rebuild** as a theme app extension (blocks + app embed) |
| Admin | Separate React app with its own login | **Rebuild** as an embedded app (App Bridge, Polaris web components) |
| Stores | One store, settings in `.env` | **Rebuild** multi-store, every record keyed by shop |
| Compliance | Uninstall webhook only | **Add** Managed Pricing, GDPR webhooks, data purge 30 days after uninstall |

## Architecture

```
 Embedded admin app (React Router + Polaris web components + App Bridge)      Theme app extension
 Onboarding · Dashboard · Search setup · Filter data · Storefront ·            Search section · Fits badge ·
 Product mapping · Settings · Plans                                            Fitment table · My Selection (embed)
              │ session-token API                                                     │ app proxy /apps/fitfinder
              ▼                                                                       ▼
 ┌──────────────────────────────── FitFinder backend (Node, hosted) ────────────────────────────────┐
 │ Import jobs (streamed CSV, mapping,     Fitment API (dropdown options,     Billing + webhooks       │
 │ modes, backups) — Bilstein engine       fit checks, results) + cache       (Managed Pricing, GDPR,  │
 │                                                                            uninstall, products/*)   │
 │ Postgres: shops, fields, fitment rows, product links, imports, settings — all keyed by shop        │
 │ Object storage: last 5 import files per shop                                                        │
 └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
              │ Admin GraphQL (products, SKUs, themes, metafields), webhooks, billing
              ▼
 Shopify: collection pages render the matched products with the merchant's theme
```

Storefront settings are mirrored to an app metafield, so blocks render without a round trip; only dropdown options, fit checks and results call the API.

## Pricing

Three plans through Shopify Managed Pricing, each paid plan with a 14-day trial; yearly = two months free. A starting proposal to validate with the first merchants.

| Plan | Monthly | Yearly | Limits | Includes |
| --- | --- | --- | --- | --- |
| Starter | Free | Free | 50 products · 5,000 rows · 3 search fields | Search section, Fits badge, CSV import with column mapping |
| Growth | $29 | $290 | 5,000 products · 500,000 rows · unlimited fields | + Fitment table (also in theme tabs), My Selection, universal products, import history with 5 backups |
| Pro | $99 | $990 | Unlimited | + scheduled imports from a supplier feed, search analytics, priority support |

For comparison: EasySearch charges $19 and $75, PartFinder $49, and Convermax from $250.

## Roadmap

About 14 weeks to App Store submission with two full-stack developers; Shopify review time comes on top. The technical plan with acceptance criteria per milestone is in `.claude/BUILD-PLAN.md`.

| Weeks | Milestone |
| --- | --- |
| 1–2 | App scaffold, auth, multi-shop data model, onboarding with store types and sample data |
| 3–5 | Search setup (fields) and the import pipeline: upload, column mapping, modes, review, history and backups |
| 6–7 | Filter data (rows, edit, delete, export, clean up) and product linking (automatic + Product mapping page) |
| 8–10 | Theme app extension: search section, fits badge, fitment table (block and theme tabs), My Selection embed; Storefront page with previews; app proxy API |
| 11 | Dashboard (setup guide, overview), Settings, Plans with Managed Pricing |
| 12 | GDPR, uninstall purge, performance (Built for Shopify thresholds), accessibility |
| 13–14 | Bilstein NL pilot on real data (727k rows), fixes, App Store listing and submission |

**After launch** (based on merchant demand): fitment notes per row (e.g. "front axle"), filtering collection pages by the shopper's selection, a cart fit check, "can't find your vehicle?" requests, search analytics, scheduled supplier imports (Pro), SEO landing pages per selection, Shopify Search & Discovery integration.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Few reviews at launch | Low App Store ranking | Bilstein NL as first public install; review request after a successful first import |
| 700k+ rows per store drives hosting cost | Margin on low plans | Row limits per plan; per-shop indexes; cached dropdown values |
| App Store rejection | Launch slips 2–4 weeks | Embedded admin, Managed Pricing, GDPR webhooks and theme app extension from day one; pre-submission checklist |
| Built for Shopify performance thresholds missed | No badge, lower trust | Small, deferred storefront script; no jQuery; settings from a metafield |
| SKU-based linking fails when merchants rename SKUs | Missing results | Product / collection links as attachments; unlinked list after every import; `products/update` webhook re-checks links |
| Themes without app-block support in the product tabs | Fitment table can't sit in tabs | `[fitfinder-table]` code replaced by the app embed works in any tab; block fallback |
| Multi-language stores | Shoppers see one language | Out of scope for MVP (texts fixed or set once); revisit with Shopify Translate & Adapt |

## Decisions needed

- [ ] Approve building FitFinder as a new Shopify app (React Router template), reusing the Bilstein NL import engine
- [ ] Approve the MVP scope shown in the prototype and the 14-week target
- [ ] Approve the three-plan pricing as a starting point
- [ ] Confirm Bilstein NL may be the first public install and case study

Open questions:

- Final app name: FitFinder is a working name; the storefront code `[fitfinder-table]` and app proxy path follow the final name.
- Team size and budget: the 14-week estimate assumes two full-stack developers.
- Hosting: managed Postgres, cache and object storage provider and region (an EU region suits Bilstein NL).
- Does the Bilstein NL store move to the public app at launch, or later?

## Sources

- [EasySearch YMM — Shopify App Store listing](https://apps.shopify.com/easysearch)
- [EasySearch YMM — reviews](https://apps.shopify.com/easysearch/reviews)
- [Best Year Make Model Search Apps for Shopify in 2026 — PickYourApp](https://pickyourapp.com/blogs/news/best-year-make-model-search-apps-for-shopify-in-2026-a-complete-guide-for-auto-parts-merchants)
- [The 8 Best Shopify Fitment Apps — Spark Shipping](https://www.sparkshipping.com/blog/the-best-shopify-fitment-apps-for-shopify-year-make-and-model-data)
- [Shopify — Scaffold an app (React Router template)](https://shopify.dev/docs/apps/build/scaffold-app)
- [Shopify — Theme app extensions configuration](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration)
- Bilstein NL product finder source code (internal review, September 2026)
- FitFinder UI prototype and specs: `.claude/design/`, `.claude/specs/`
