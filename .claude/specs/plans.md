# Plans

**Prototype:** `design/scripts/screens/plans.js` · **Real app:** **Billing API (Manual Pricing)**, agreed 2026-10-13. The plans (four slots) are edited in the backoffice (`specs/backoffice.md`). This screen creates the charge with the plan's price and trial and opens Shopify's approval page.

## Layout
1. **Your plan** (`s-section`, two columns): "Your plan: {name}", an info badge "Free trial · {n} days left", and "Billed through Shopify on your Shopify invoice. You can change or cancel your plan any time." On the right are usage meters (label, "{used} of {limit}", a thin bar in the theme colour) for **Filter rows** and **Linked products**.
2. A line "Every paid plan starts with a {n}-day free trial." It shows only when every visible paid plan has the same trial; otherwise each card except the current plan's shows its own "{n}-day free trial". The trial takes off the days the store has already used. Then a **Monthly / Yearly** switch (two buttons; the selected one is secondary), shown only when a plan has a yearly price.
3. One card per visible plan (`s-section`, plain Polaris, no colour strips; equal height, buttons aligned at the bottom). Two cards sit side by side, three in a row, four as two rows of two.
   - Card content:
     - name, plus a success badge "Current plan"
     - price: "Free", "$29 / month" or "$290 / year"
     - description
     - one bulleted list (`cardLines`): the generated lines, with the backoffice's own card lines placed among them where the backoffice puts them (2026-10-19; lines saved earlier sit at the bottom):
       - the limits: "5,000 filter rows", "Unlimited linked products"…
       - the included features: "Fitment table", "My Selection floating button", "Custom CSS"…
   - Button:
     - "Current plan" (disabled)
     - **Upgrade to {plan}** (primary)
     - **Switch to {plan}**
     - **Choose {plan}** (primary) before any plan is picked

## Behaviour
- **Paid plan.** `appSubscriptionCreate` is called with:
  - name "SpareFit {Plan}", with " (yearly)" added for yearly
  - one recurring line item at the plan's price in USD (`EVERY_30_DAYS` / `ANNUAL`)
  - `trialDays` = the plan's trial minus the days already used
  - `returnUrl` = `https://admin.shopify.com/store/{store}/apps/{handle}/app/plans?charge=1`
  - `replacementBehavior: STANDARD`
  - `test` on development stores (or with `SHOPIFY_BILLING_TEST=true`)

  Back from the approval page (`?charge=1`; Shopify adds `charge_id`), the plan is always read fresh from Shopify, even within 10 s of the last read (other reloads of Plans read it at most every 10 s), so a quick approval shows the new plan at once.
  The approval page opens in the top window. The charge is stored in `app_subscriptions`, so the plan is known even after it is renamed.
- **Free plan.** Before any plan is picked, it is saved at once (there is nothing to cancel). Otherwise a confirm `s-modal` asks "Switch to {plan}?". It reads "Your current plan is cancelled right away and {plan}'s limits apply. Features your new plan doesn't include stop showing in your store." and has a red **Switch plan** button plus Cancel. Confirming calls `appSubscriptionCancel` on the active charge, and the toast "Plan changed" shows. Errors show as error toasts.
- **Reading the plan.** It is read from `currentAppInstallation.activeSubscriptions` and stored in `shops.plan` / `trial_ends_at` / `subscription_id`. Reads happen:
  - at most every 5 minutes per shop on admin pages
  - fresh on every Plans visit
  - on the `app_subscriptions/update` webhook
  - Without an active charge, a shop that chose a free plan keeps it; otherwise its plan is "none".
- **No plan picked yet.** The first free plan's limits apply (visible ones first). If no plan is free, the shop gets nothing (no rows, products or features) until it picks a plan; it never gets a paid plan's limits for free. The plan section reads "You haven't picked a plan yet, so {plan}'s limits apply. Pick a plan below; it's billed through Shopify on your Shopify invoice."
- **Changes from the backoffice.** Price and trial changes apply to new charges only; existing subscribers keep what they approved. Limit and feature changes apply at once. Data is never deleted: stores over a lowered limit see the over-limit banner.
- **Enforced on the server:**
  - **Filter rows:** Add row and imports. Over the limit nothing is imported: "Nothing was imported. The {Plan} plan allows up to {n} filter rows. Upgrade on the Plans page to add more."
  - **Linked products:** manual links and universal products.
  - **Search fields:** up to 10 on every plan (not a plan setting since 2026-10-19). Each plan card says "Up to 10 search fields".
  - **Import backups:** a plain on/off feature (no count since 2026-10-19). On: the history lists the last 5 imports with Download, and the card shows "Backups of your last 5 imports". Off: no card line; the history shows "Download the files you imported any time." and the newest 3 imports under the locked layer (search-setup.md › Import history), and the file download is refused. The files of the last 5 imports are kept per shop whatever the plan, so a downgrade and upgrade brings them back.
  - **Universal products** (feature): new ones are refused when the plan doesn't include it; existing ones stay (nothing is deleted).
  - **Fits badge, Fitment table, My Selection** (features): the storefront config marks them off and the theme blocks render nothing. The config is published again on the billing webhook and on admin visits. The Storefront page's Theme integration table shows "Needs {plan} plan" with an **Upgrade →** link. {plan} is the cheapest visible plan that has the feature; "Needs a higher plan" shows when none has it.
  - **Custom CSS** (feature, added 2026-10-16): the Settings action refuses a save ("Your plan doesn't include custom CSS.") and the storefront config publishes `css` only when the plan includes it, so a downgrade removes the CSS from the store (the stored CSS is kept). Settings shows "Custom CSS needs the {plan} plan" (or "…a higher plan") with **Compare plans**. Off on every seeded plan until the super admin switches it on.
  - Auto-linking isn't refused; the over-limit banner shows instead.
- **Banners:** a read failure shows the warning "Your plan couldn't be checked". Meters turn red past the limit.
- Dashboard setup step 5 ("Plan") is done once a plan is picked. Before that, it reads "Pick the plan that suits your catalog." followed by one of:
  - "{Free plan} is free; paid plans start with a {n}-day free trial."
  - "{Free plan} is free."
  - "Paid plans start with a {n}-day free trial."

  {n} is this shop's remaining trial, as on Plans. The trial part shows only when every paid plan has the same trial.

## Seeded plans (migration `20261013120000_plans_backoffice`; editable)
| Plan | Monthly | Yearly | Trial | Limits | Features | Shown |
|---|---|---|---|---|---|---|
| Starter | Free | — | — | 50 products · 5,000 rows | Fits badge, Import backups | yes |
| Growth | $29 | $290 | 14 days | 5,000 products · 500,000 rows | + Fitment table, My Selection, universal products | yes |
| Pro | $99 | $990 | 14 days | Unlimited products and rows | as Growth | yes |
| Business | $199 | $1,990 | 14 days | Unlimited products and rows | as Pro | no |

Every plan: up to 10 search fields; Import backups (when on) keeps the last 5 imports. Old `searchFields` / `backups` keys in the seeded limits are ignored.

## Public landing page (`/`)
Since 2026-10-19 the landing page has a **Pricing** section between the features and "Already using SpareFit?": the shown plans as cards (name, price "Free" / "$29 / month", description, a trial line only when paid plans differ, the same `cardLines` with check icons), a Monthly / Yearly switch when a plan has a yearly price, "Every paid plan starts with a {n}-day free trial. Billed through Shopify." when all trials match, and a button to the App Store listing ("Get started free" / "Start free trial" / "Get started"). Read from the plans table like the Plans page; when it can't be read, the section is left out. (Prices on our own site are fine; the App Store listing keeps prices in its Pricing section only.)
