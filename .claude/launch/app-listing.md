# SpareFit: App Store listing and review submission

Every text the Partner Dashboard asks for, ready to paste, in the order the submission flow shows it. Each text sits in a code block so it copies cleanly. Values in `[square brackets]` are yours to fill in.

Rules re-checked 2026-10-19 against the live docs:
- [App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements), section 4 (listing) and 4.5 (submission)
- [Best practices](https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices) (field limits)
- [Pass app review](https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review)

**Rules for every text and image:**
- No statistics or data, no guarantees, and no "the best", "the first" or "the only" (4.3.3, 4.3.4).
- Prices appear only in the Pricing section: not in the intro, details, features, screenshots or icon (4.2.2, 4.2.3).
- No reviews or testimonials (4.3.6, 4.3.7).
- No Shopify logos or trademarks in graphics (4.4.3).
- Don't mention your other apps or services (4.4).

---

## 1. App setup (Partner Dashboard)

| Item | What to enter |
| --- | --- |
| Distribution | **Public** (done 2026-10-15) |
| App URL | `https://sparefit.progryss.com` (set by `shopify.app.toml`) |
| API contact email | `progryss@gmail.com` (must not contain the word "Shopify") |
| Emergency developer contact (4.5.6) | Partner Dashboard › **Settings › Account**: email `[email]` and phone `[phone with country code]` |
| Protected customer data | **"My app won't use customer data"**. SpareFit has no customer or order scopes, stores nothing about shoppers, and discards `logged_in_customer_id` from app proxy requests. |

---

## 2. Listing: basic information

### App name (≤ 30 characters)

```
SpareFit – Parts Finder
```

This is 23 characters. It is the same as the TOML `name`, which meets 4.1.1.

### App icon

- 1200 × 1200 px, PNG or JPEG.
- Bold colours and a simple shape, with padding. Shopify rounds the corners itself.
- **No text, no screenshot, no Shopify marks and no price.**
- Status: **to create**.

### App card subtitle

```
Help shoppers find products that fit their vehicle or device
```

The subtitle must name a benefit, with no search keywords and no numbers. Check it against the counter in the form.

### App introduction (≤ 100 characters)

```
Shoppers pick their vehicle and see only parts that fit, helping you cut wrong orders and returns.
```

### App details (≤ 500 characters)

```
SpareFit adds a "find what fits" search to your store. Shoppers choose their vehicle, phone or profile from dropdowns you define and see only the products that fit. Start from a store type, then rename or add search fields. Import fitment data from a CSV in any column layout; rows link to your products by SKU, handle or collection. Add the search, a fits badge and a fitment table from the theme editor, with no code. Results open on your theme's own search page.
```

### Feature list (≤ 80 characters each)

```
Search by any fields: make, year and model, or brand, series and device
```
```
CSV import with column mapping, a review step and backups of recent files
```
```
Products linked automatically by SKU, handle or collection
```
```
Search section, fits badge and fitment table blocks for your theme
```
```
My Selection lets returning shoppers reuse a saved vehicle in one click
```
```
See how shoppers use the search with built-in analytics
```

### Search terms (up to 5, one idea each)

```
fitment search
```
```
year make model
```
```
parts finder
```
```
product filter
```
```
vehicle search
```

### Other fields

| Field | Value |
| --- | --- |
| Category | Store design › Search and filters. Tick only the category features SpareFit really has (4.3.5). |
| Languages | English only (4.3.2) |
| Sales channel requirement | Tick **"Merchant must have online store"**. The storefront parts are theme app extension blocks (4.3.1). |
| Geographic requirements | None |
| Integrations | Leave empty |

---

## 3. Media

### Feature image (or video)

- **Image:** 1600 × 900 px (16:9), with one focal point on a solid background and contrast of at least 4.5:1.
  - Subject: the search widget with three dropdowns, plus a "Fits your vehicle" badge.
  - No Shopify logo, no price, and don't repeat the subtitle.
- **Or a video:** 2–3 minutes and promotional, with screen recordings making up no more than 25 % of it.
- **Alt text:**

```
Shopper choosing make, year and model to find parts that fit
```

### Desktop screenshots (3–6, 1600 × 900)

- Show the real UI.
- No browser chrome, desktop background, personal data or prices. That rules out the Plans page.
- Each screenshot must show a different screen.
- Take them on the demo store.

| # | Screen | Alt text |
| --- | --- | --- |
| 1 | Dashboard: banner, setup guide and overview | `SpareFit dashboard with setup guide and store overview` |
| 2 | Search setup: the field grid and the Import CSV card on Map columns | `Mapping CSV columns to search fields` |
| 3 | Storefront: Theme integration table and the Search widget live preview | `Storefront settings with a live preview of the search` |
| 4 | Product mapping: unlinked SKUs and the product picker | `Linking SKUs to products` |
| 5 | Shopper view: the search section on the home page (crop to the page content) | `Search by make, year and model on the storefront` |
| 6 | Shopper view: product page with the fits badge and fitment table | `Fits badge and fitment table on a product page` |

**Mobile screenshot (optional, recommended):** the storefront search works on phones. Add one phone-width capture of the search section, with this alt text:

```
Parts search on a mobile storefront
```

---

## 4. Pricing (the only place prices appear)

**Billing method:** **Recurring charge**, with Starter marked **Free** so the listing shows "Free plan available".

> **Copy the values from the production backoffice** (`https://sparefit.progryss.com/backoffice/plans`). The table below is from the local database on 2026-10-19 and may differ from production. The listing, the backoffice and the in-app Plans page must match exactly, including every trial and every charge (4.2.1). The plan lines are the card lines the backoffice shows. Only list plans whose status is **Shown**.

| Plan | Price | Yearly | Free trial |
| --- | --- | --- | --- |
| Starter | Free | none | none |
| Growth | $29 / month | $290 / year | 14 days |
| Pro | $49 / month | $490 / year | 14 days |
| Business | $99 / month | $990 / year | 14 days |

**Plan features (one line per row in the form):**

**Starter**
```
100 linked products
1,000 filter rows
Up to 10 search fields
Fits badge
Search section
CSV import with column mapping
```

**Growth**
```
5,000 linked products
50,000 filter rows
Up to 10 search fields
Fits badge
Fitment table
My Selection floating button
Universal products
Backups of your last 5 imports
```

**Pro**
```
10,000 linked products
100,000 filter rows
Up to 10 search fields
Fits badge
Fitment table
My Selection floating button
Universal products
Backups of your last 5 imports
Custom CSS
```

**Business**
```
Unlimited linked products
Unlimited filter rows
Up to 10 search fields
Fits badge
Fitment table
My Selection floating button
Universal products
Backups of your last 5 imports
Custom CSS
```

**Description of additional charges:** leave this empty. There are none, and no usage charges.

---

## 5. Support and links

| Field | Value |
| --- | --- |
| Support email | `progryss@gmail.com` |
| Support / help URL | `[help or FAQ page URL]`. It must be a dedicated page, not the landing page or a cloud document. |
| In-app support | Live chat through Settings › Help (chat.progryss.com) |
| Privacy policy URL | `[public privacy policy page URL]`. Publish `privacy-policy.html` there; it can't be a cloud document. Also set `PRIVACY_POLICY_URL` on the server so the landing page footer links to it. |
| Demo store URL | `[demo store product page URL]`: link straight to a product page that shows the fits badge and the fitment table. |
| Demo store password | `[storefront password]` |

---

## 6. Review submission

### Testing instructions (paste into the review form; limit 2,800 characters)

About 2,250 characters with the placeholders, so there is room for the real links. The screencast link goes in the form's own screencast field; if the form has none, add a line "SCREENCAST: [link]" before NOTES.

```
TEST CREDENTIALS
None needed. SpareFit has no separate login; it uses the Shopify admin session. Everything is reachable from the app menu.

WHAT THE APP DOES
A "find products that fit" search. The merchant defines dropdowns (e.g. Make / Year / Model), imports fitment rows from a CSV, rows link to products by variant SKU or handle, and theme app extension blocks show the search, a "fits" badge and a fitment table on the storefront.

STEPS (about 10 minutes)
1. Install and open the app. Choose the Automotive store type and click Continue. Expected: the Dashboard opens with a setup guide.
2. Search setup > Import CSV: upload the attached reviewer-sample.csv (12 rows: Make, Year, Model, Attachment). Columns map automatically; click Review, then Import. Expected: a success toast, a row in Import history, and 12 rows in Filter data.
3. The Attachment values are SKUs (e.g. SP-BRAKE-001) that won't exist on your store. Give one or two test products these variant SKUs, or open Product mapping and use Choose product on an unlinked SKU. Expected: the SKU shows as Linked.
4. Storefront > Theme integration: click the App embed button (opens the theme editor on App embeds; turn SpareFit on and Save). Then click Add to theme for Search section, Fits badge and Fitment table; each opens the theme editor with the block placed; click Save. Expected: each row shows Added.
5. On the storefront, pick Make, Year and Model and click Show parts. Expected: the theme search page lists the linked products; a linked product page shows "Fits your vehicle" and the fitment table.
6. Plans: Starter is free and applies until a plan is picked, so no plan is forced at install. Click Choose on a paid plan. Expected: Shopify's approval page shows the price and 14-day trial; after approving you return to Plans with the new plan and trial shown. Choosing Starter cancels the paid charge after a confirmation.

DEMO STORE
[demo store product page URL] (password: [storefront password])

NOTES
- Requires Online Store 2.0 themes (theme app extension; tested on Horizon and Dawn).
- No customer data stored; a shopper's saved selection stays in their browser.
- Uninstall removes the storefront search at once; store data is deleted 30 days later.
```

Attach `reviewer-sample.csv` (this folder), or host it and paste its link into the instructions.

### Demo screencast (required, 4.5.3)

- English, or English subtitles.
- An unlisted YouTube, Vimeo or Loom link.
- Recorded on a development store.
- Show each step and its result:

1. Install from the Partner Dashboard link → OAuth screen → the app opens on onboarding (no menu yet).
2. Choose **Automotive** → Continue → the Dashboard with the setup guide.
3. **Search setup** → Import CSV:
   1. Upload `reviewer-sample.csv`.
   2. Map columns (auto-mapped) → Review → Import.
   3. Result: a toast and a new row in Import history.
4. **Filter data:**
   1. Show the imported rows.
   2. Add one row in the modal.
   3. Delete one row, with the confirm modal.
5. **Product mapping** → unlinked SKUs → **Choose product** for one SKU → it moves to Linked.
6. **Storefront:**
   1. App embed → theme editor (App embeds) → turn SpareFit on → Save → back in the app the embed shows On.
   2. **Add to theme** for the Search section, Fits badge and Fitment table → each opens the theme editor with the block placed → Save → the rows show Added.
7. **Shopper view:**
   1. Pick Make → Year → Model → **Show parts**. The theme search page lists the fitting product.
   2. The product page shows "Fits your vehicle" and the fitment table.
   3. My Selection saves the vehicle.
8. **Plans:**
   1. **Choose Growth** → Shopify's charge approval page → Approve.
   2. Back on Plans, Growth shows with the trial badge.
   3. Switch back to Starter (confirm modal).
9. **Settings** → the Your data text. Then uninstall; the storefront search disappears.

### Before you click Submit

- [ ] App icon, feature image and 3–6 screenshots uploaded, each with alt text.
- [ ] Pricing matches the production backoffice exactly.
- [ ] Privacy policy, help page and demo store links open without logging in. A storefront password is fine if it is given in the instructions.
- [ ] Emergency developer contact saved.
- [ ] Protected customer data: "My app won't use customer data".
- [ ] Testing instructions pasted, CSV attached and screencast link added.
- [ ] The automated checks on the review page all pass.
- [ ] `noreply@shopify.com` added to your allowed senders. Answer reviewer emails quickly.
