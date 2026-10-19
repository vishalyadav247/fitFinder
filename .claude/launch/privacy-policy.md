# SpareFit privacy policy

> Editor's note (remove before publishing): publish this on a dedicated public page (your website, not a cloud document) and use its URL as the App Store listing's privacy policy URL. Rewritten 2026-10-15 in the structure of the ChatConvert policy. Checked against the code: `shopify.app.toml` scopes (`read_products, write_app_proxy, read_themes, write_files`), `prisma/schema.prisma` (offline sessions only, no customer tables), `app/services/purge.server.ts` (30 days after uninstall), the 180-day analytics purge in `app/services/jobs.server.ts`, `app/routes/webhooks.compliance.tsx`, `app/services/subscription.server.ts` (Billing API) and the storefront scripts in `extensions/sparefit-theme/assets/` (localStorage and sessionStorage only, no cookies). Updated 2026-10-16: app logs (`app/services/logs/`, 7/14/30-day retention set in `/backoffice/logs`, default 14, deleted with the shop by `purge.server.ts`) and backups (the last 5 imports per store, since 2026-10-19). **Confirm before publishing (still in [brackets]):** the hosting providers in section 8 (the build plan names Fly.io, Neon or Supabase and Cloudflare R2, all EU; replace them with what `sparefit.progryss.com` actually runs on) and your hosting provider's own log retention in section 9. If you change the in-app log retention above 30 days, update section 9. Update this page whenever scopes, providers or stored data change.

**Last updated:** 16 October 2026

SpareFit – Parts Finder ("SpareFit", "the App") is a "find products that fit" search for Shopify stores, built and operated by Progryss Media Private Limited ("Progryss", "we", "us"). The App adds a search to a merchant's storefront where shoppers pick values such as year, make and model (or any fields the merchant sets up) and see only the products that fit. It can also show a "fits / doesn't fit" badge and a fitment table on product pages, and lets shoppers keep their selections in "My Selection". Merchants fill the search with their own fitment data, imported from CSV files or added by hand, and link it to their products. This policy explains what data the App collects, how we use it, who we share it with, and the choices merchants and shoppers have.

By installing SpareFit, you agree to the collection and use of information as described here. If you do not agree, please do not install or use the App.

## 1. Who is responsible for what

- **The merchant** is the data controller for their store's data. They decide what fitment data to upload and how their storefront search works.
- **Progryss** is the data processor. We store and process that data only to provide the App to that merchant, on their instructions.
- Every record in our database is scoped to a single store. One merchant's data is never readable by another merchant.

If you are a shopper who used SpareFit's search on a store, the store is your point of contact. SpareFit does not collect personal data about shoppers (see section 3), but we will pass any request you send us on to that merchant.

## 2. What we collect from merchants

When you install SpareFit, Shopify gives the App access to some information about your store, limited to the permissions you approve:

- **Store details:** your store's myshopify domain, the install and uninstall dates, and the access token Shopify issues so the App can work with your store. We do not receive or store staff names, staff email addresses or your Shopify login credentials.
- **Product catalog** (`read_products`): product titles, handles, statuses, variant SKUs and images. We keep a copy in our database so we can link your fitment data to your products by SKU, and update it when Shopify tells us a product has changed. We never change your products.
- **Theme status** (`read_themes`): whether your themes contain SpareFit's blocks and app embed, so the App can show whether the search is live. We store only that status, not your theme code. We never change your themes.
- **Files** (`write_files`): only the My Selection icon you upload yourself is stored in your store's Files.
- **Storefront proxy** (`write_app_proxy`): lets your storefront search reach the App through Shopify's signed app proxy.
- **App configuration:** your store type, search fields, fitment (filter) rows, product links, universal products, storefront texts, colours and settings. Your search fields and storefront texts are also saved as an app setting (an app-owned metafield) on your store so your theme can show them.
- **Imported files:** the CSV files you import, with your column mapping. We keep the files of your last 5 imports as backups you can download (when your plan includes import backups), together with the error reports we create from them.
- **Billing status:** your plan, subscription state and trial dates. All charges are handled by the Shopify Billing API; we never see or store payment details.
- **Search statistics:** daily counts for the Analytics page (see section 3). These are aggregate numbers, not personal data.
- **Support chat:** when you use the support chat inside the App, the messages you send and any contact details you choose to give are handled by our own support chat service (chat.progryss.com), so we can answer you. We use them only to give you support.
- **Operational logs:** technical events such as webhook deliveries, background jobs, errors, warnings and slow requests, with your store's domain and the page or job involved. Access tokens, passwords and other secrets are removed before an entry is saved, and the logs never contain shopper data.

## 3. What we collect from shoppers

SpareFit does **not** collect or store personal information about shoppers.

- **Search picks:** when a shopper uses the search, their storefront sends the values they picked (for example a make and model) to the App, so we can return matching products. These requests contain no names, emails, addresses, orders or account details.
- **Aggregate statistics:** to show the merchant how the search is used, we count per day how often each selection was searched, how often a search found nothing, and how often a product page was checked against a selection. These counts contain nothing about who searched: no IDs, IP addresses, sessions or devices. They are deleted after 180 days.
- **Logged-in customer ID:** Shopify can add a logged-in customer's ID to app proxy requests. SpareFit does not use or store it.
- **Connection data:** requests reach us through Shopify's app proxy. Our hosting provider may process connection data (such as IP addresses) in transit to deliver them, but we do not log or store shopper IP addresses.

We do not collect shopper payment details or location, and we use no third-party analytics or advertising trackers.

## 4. Cookies, storage and consent

SpareFit sets **no cookies** on the storefront. The storefront scripts use the browser's own storage, which never leaves the shopper's device:

- **localStorage:** the shopper's saved selections ("My Selection") and the position of the My Selection tab, so they are still there on the next visit.
- **sessionStorage:** short-lived, per-tab state, such as the last search, so the results page and page reloads behave correctly.

This data is never sent to our servers as a profile, is not shared with anyone, and the shopper can clear it at any time by clearing their browser's site data. SpareFit does not track shoppers across sites and does not build advertising profiles.

## 5. Protected customer data

SpareFit does not request access to orders or customers (no `read_orders`, `read_customers` or similar scopes) and does not store any customer records. It therefore does not process Shopify's protected customer data.

## 6. How we use it

- To run the storefront search: show the right dropdown values, find the products that fit a selection, and show fit badges and fitment tables.
- To import, check and store your fitment data, link it to your products, and keep those links up to date when your catalog changes.
- To show you your setup, data, product mapping and search statistics in the App.
- To manage plans and billing through Shopify, provide support, diagnose errors, and keep the App secure and compliant.
- To run the App as a business: our own administration area shows us app-wide figures such as the number of installed stores, plans and trials, each store's setup (search fields, row and link counts, search counts) and the operational logs described in section 2.

We do not sell or rent any merchant or shopper data, we do not share it with advertisers or data brokers, we do not use it for our own marketing, and we never use one merchant's data to serve another merchant.

**No AI and no automated decisions.** SpareFit does not use artificial intelligence. Matching, column mapping and product linking are rule-based. The App does not make decisions with legal or similarly significant effects about any individual.

## 7. AI processing

SpareFit does not send any data to AI or machine-learning services.

## 8. Sharing and sub-processors

We share data only with the services required to run the App:

- **Shopify** — the platform the App runs on (install, authentication, product catalog, billing, app proxy and the storefront where the search appears).
- **[Fly.io]** — application hosting, EU region (Amsterdam), where the App's backend runs.
- **[Neon / Supabase]** — managed PostgreSQL database, EU region, where stored data lives.
- **[Cloudflare R2]** — storage of imported files, backups and error reports.

Beyond these, we disclose data only if required by law. Merchants are notified of any material change to our sub-processors through an update to this policy.

## 9. Retention and deletion

- **Store configuration, fitment data, product links and catalog copy** — kept for as long as the App is installed.
- **Imported files** — the files of the last 5 imports per store are kept; older ones are deleted when a new import replaces them.
- **Search statistics** — deleted after 180 days by a daily job.
- **Operational logs** — the errors, warnings and slow requests the App records are kept for up to 30 days (14 days by default), then deleted by a daily job; a store's entries are also deleted with the rest of its data after uninstall. Our hosting provider's own server logs are kept for [30] days, then deleted.
- **After uninstall** — the search disappears from your store straight away and billing stops. Your data is kept for 30 days so an accidental uninstall or a quick reinstall does not lose your setup. After 30 days, every record belonging to your store is permanently deleted: search setup, fitment data, product links, imports, backups, reports, statistics, settings and access tokens. This meets the 30-day deadline Shopify sets for its shop/redact request.
- **Earlier deletion** — you can ask us to delete your store's data sooner by contacting us (section 16).

## 10. Shopify compliance webhooks (GDPR)

SpareFit implements all three of Shopify's mandatory privacy webhooks:

- **customers/data_request** — SpareFit stores no customer data, so there is nothing to export; we acknowledge the request.
- **customers/redact** — SpareFit stores no customer data, so there is nothing to delete; we acknowledge the request.
- **shop/redact** — we permanently delete all of the store's data, as described in section 9.

## 11. Other channels

SpareFit works only on the merchant's Shopify storefront and in the Shopify admin. It does not connect to WhatsApp, Facebook, Instagram or any other messaging or social platform.

## 12. Security and data transfers

- All data is transmitted over HTTPS/TLS and stored on managed cloud infrastructure.
- Every database query is scoped to a single store; cross-store access is prevented by design and covered by automated tests.
- The App authenticates with Shopify session tokens; we never collect or store Shopify login credentials.
- Storefront requests are verified through Shopify's signed app proxy, and every Shopify webhook is HMAC-verified before any processing.
- Access tokens and provider secrets are kept server-side only and never exposed to the storefront.
- Access to our systems is limited to the people who run the App. Our administration area is protected by a password stored only as a hash.
- Data is stored in the European Union. Our team is based in India and may access data from there for support and maintenance; where required, transfers rely on recognised safeguards such as Standard Contractual Clauses.

No system is perfectly secure. If we become aware of a breach affecting personal data, we will notify affected merchants without undue delay and cooperate with them as the controller.

## 13. Your rights

Depending on where you live (including under the GDPR and CCPA/CPRA), you may have the right to access, correct, delete or receive a copy of your personal data, and to object to or restrict its processing.

- **Shoppers:** SpareFit holds no personal data about you. Your saved selections are only in your own browser, and you can clear them there. For anything else, contact the store you visited.
- **Merchants:** contact us at the address below for any data request about your store and we will respond within 30 days.

You may also lodge a complaint with your local supervisory authority.

## 14. Children

SpareFit is a business tool for merchants and is not directed at children. We do not knowingly collect personal data from children. If you believe a child's data has reached us, contact us and we will delete it.

## 15. Changes to this policy

We may update this policy from time to time; the "Last updated" date at the top will change when we do. If we make a material change, such as a new sub-processor, a new category of data or a different retention period, we will notify installed merchants before the change takes effect.

## 16. Contact

- **Email:** progryss@gmail.com
- **Business:** Progryss Media Private Limited, First Floor, Workspace By Innova, H-54, H Block, Sector 63, Noida, Uttar Pradesh 201301
- **Governing law:** India
