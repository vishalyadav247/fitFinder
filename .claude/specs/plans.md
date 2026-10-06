# Plans

**Prototype:** `design/scripts/screens/plans.js` · **Real app:** **Shopify App Pricing** (formerly Managed Pricing; Shopify hosts the plan selection and approval page; this screen shows the current plan and links there)

## Layout
1. **Your plan** (`s-section`, two columns) — "Your plan: {name}" + info badge "Free trial · {n} days left" + "Billed through Shopify on your Shopify invoice. You can change or cancel your plan any time." On the right, usage meters (label, "{used} of {limit}", thin bar): **Filter rows**, **Linked products**. (No search-field meter: every plan allows as many search fields as the store needs.)
2. Line "Every paid plan starts with a 14-day free trial." + **Monthly / Yearly · 2 months free** switch (two buttons; selected = secondary).
3. Three plan cards (`s-section`, plain Polaris, no colour strips): name (+ success badge "Current plan"), price ("$29 / month" or "$290 / year"), limits line, feature list, button: "Current plan" (disabled) / **Upgrade to {plan}** (primary) / **Switch to {plan}**. Prototype toast: "Opens Shopify to approve the plan change".

## Proposed plans (not final)
| Plan | Monthly | Yearly | Limits | Includes |
|---|---|---|---|---|
| Starter | Free | Free | 50 products · 5,000 rows | Search section and Fits badge, CSV import with column mapping |
| Growth | $29 | $290 | 5,000 products · 500,000 rows | Everything in Starter, fitment table (also inside theme tabs), My Selection, universal products, import history with 5 backups |
| Pro | $99 | $990 | Unlimited | Everything in Growth, scheduled imports from a supplier feed, search analytics, priority support |

## Real app (Shopify App Pricing, formerly Managed Pricing)
- Configure the plans (monthly and yearly) in the Partner Dashboard. **Plan handles must be the plan key** (`starter`, `growth`, `pro`), optionally followed by `-…` or `_…`. Set each plan's welcome link to `/app/plans`. Plan buttons open Shopify's hosted page `https://admin.shopify.com/store/{store}/charges/{app_handle}/pricing_plans` in the top window.
- The active plan comes from the Partner API (`activeSubscription`); Shopify App Pricing sends no billing webhooks. Read at most every 5 minutes per shop from the Dashboard and fresh on every Plans visit (and on the welcome link's `plan_handle`), stored in `shops.plan` / `trial_ends_at`. Env: `SHOPIFY_PARTNER_ORG_ID`, `SHOPIFY_PARTNER_API_ACCESS_TOKEN`, `SHOPIFY_APP_GID`, `SHOPIFY_APP_HANDLE`.
- No plan picked yet: Starter's limits apply (no forced redirect, decided 2026-10-06). The plan section then reads "You haven't picked a plan yet, so Starter's limits apply. Pick a plan below; it's billed through Shopify on your Shopify invoice.", no card shows "Current plan" and every card's button is **Choose {plan}** (primary).
- Search fields are **not** limited by plan (decided 2026-10-06: 3, 4, 5 or more depending on the store; only the technical cap of 20 applies to everyone).
- Number limits are enforced server-side: Add row, imports (over the limit nothing is imported: "Nothing was imported. The {Plan} plan allows up to {n} filter rows. Upgrade on the Plans page to add more."), manual links and universal products ("linked products" = distinct products in product links or universal). Auto-linking isn't refused; the over-limit banner shows instead. Feature limits per plan are **not** enforced yet (decided 2026-10-06; the plan list isn't final).
- Banners: billing not connected (env missing) → warning "Plans can't be changed here yet"; Partner API read failed → warning "Your plan couldn't be checked". Meters turn red past the limit.
- Dashboard setup step 5 ("Plan") is done once a subscription is active.
