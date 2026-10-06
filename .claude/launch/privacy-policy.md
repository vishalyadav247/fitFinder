# FitFinder privacy policy (draft)

> Draft for the App Store listing's privacy policy URL (required). Fill in the bracketed parts, have it reviewed, and publish it on a dedicated public page (your website; not a cloud document) before submitting. Checked 2026-10-06 against what the app stores (`prisma/schema.prisma`: shops, sessions (offline tokens only), search setup, filter rows, imports, product links, catalog cache, theme status, storefront settings), `app/services/purge.server.ts`, `app/routes/webhooks.compliance.tsx` and Settings › Your data. If you change hosting providers or add analytics, update this page.

**Last updated:** [date]

FitFinder ("the app") is provided by [legal company name], [address] ("we", "us"). This policy explains what information the app collects when a merchant installs it on a Shopify store, how we use it, and how it is deleted.

## Information we collect

When you install FitFinder, Shopify gives the app access to some information about your store, limited to the permissions you approve:

- **Store details:** your store's myshopify domain, the install and uninstall dates, and the access token Shopify issues to the app (an offline token for the store; we don't receive or store staff names or email addresses).
- **Product information** (`read_products`): product titles, handles, statuses, variant SKUs and collection memberships. We keep a copy of these in our database to link your fitment data to your products, and update it when Shopify tells us a product changed. We don't change your products.
- **Theme information** (`read_themes`): which of your themes contain FitFinder's blocks and app embed, so the app can show whether the search is live. We store only that status, not your theme files. We don't change your themes.
- **Files** (`write_files`): only the My Selection icon you upload yourself is stored in your store's Files.
- **Plan information:** your current FitFinder plan and trial end date, read from Shopify.
- **Storefront settings:** your search fields and storefront texts are also saved as an app setting (metafield) on your store so your theme can show them.

Information you give the app directly:

- your search fields, fitment (filter) rows, product links, storefront texts and settings;
- the CSV files you import (we keep the last 5 as backups you can download) and the error reports we create from them.

## Information about your customers

FitFinder does **not** collect or store personal information about your customers (shoppers). A shopper's saved selections ("My Selection") are stored only in their own browser (local storage) and never sent to our servers. Storefront requests to the app (dropdown options, "fits" checks, results) contain the shopper's picks (for example a make and model) but no names, emails, addresses, orders or other personal data, and we don't store them. These requests reach us through Shopify's app proxy; our hosting provider may process connection data (such as IP addresses) in transit to deliver them, but we don't log or store shopper IP addresses. FitFinder doesn't use the logged-in customer ID that Shopify can add to these requests.

Our server logs contain your store's domain and technical events (for example webhook deliveries and errors). They contain no shopper data and are kept for [log retention, e.g. 30 days] by our hosting provider.

## How we use information

We use the information above only to provide the app's features to you: building your search, linking rows to products, showing the search in your theme and showing your plan and usage. We don't sell or share it for advertising.

## Billing

Plans are billed by Shopify on your Shopify invoice. We read your current plan from Shopify; we never see or store payment details.

## Service providers

We use these providers to run the app, all in the EU:

- [Fly.io] — application hosting (Amsterdam);
- [Neon / Supabase] — database;
- [Cloudflare R2] — storage of imported files, backups and reports.

## Retention and deletion

- **When you uninstall the app**, the search stops showing on your store straight away. Your data is kept for 30 days in case you reinstall, then deleted for good: database records, imported files, backups and reports.
- **Data requests:** we respond to Shopify's privacy webhooks (customer data requests, customer redaction and shop redaction). Because we store no customer data, customer requests have nothing to return or delete; shop redaction requests are completed by the deletion above, within 30 days of the request.
- You can ask us to delete your data sooner by contacting us.

## Security

Data is sent over HTTPS. Access to our systems is limited to the people who run the app. Storefront requests are verified with Shopify's app proxy signature.

## Your rights

Depending on where you are, you may have the right to access, correct or delete your information. Contact us at [support email] and we will respond within 30 days.

## Changes

We will post changes to this policy on this page and update the date above.

## Contact

[legal company name] · [address] · [support email]
