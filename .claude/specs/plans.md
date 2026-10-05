# Plans

**Prototype:** `design/scripts/screens/plans.js` · **Real app:** Shopify **Managed Pricing** (Shopify hosts the plan selection and approval page; this screen shows the current plan and links there)

## Layout
1. **Your plan** (`s-section`, two columns) — "Your plan: {name}" + info badge "Free trial · {n} days left" + "Billed through Shopify on your Shopify invoice. You can change or cancel your plan any time." On the right, usage meters (label, "{used} of {limit}", thin bar): **Filter rows**, **Linked products**, **Search fields**.
2. Line "Every paid plan starts with a 14-day free trial." + **Monthly / Yearly · 2 months free** switch (two buttons; selected = secondary).
3. Three plan cards (`s-section`, plain Polaris, no colour strips): name (+ success badge "Current plan"), price ("$29 / month" or "$290 / year"), limits line, feature list, button: "Current plan" (disabled) / **Upgrade to {plan}** (primary) / **Switch to {plan}**. Prototype toast: "Opens Shopify to approve the plan change".

## Proposed plans (not final)
| Plan | Monthly | Yearly | Limits | Includes |
|---|---|---|---|---|
| Starter | Free | Free | 50 products · 5,000 rows · 3 search fields | Search section and Fits badge, CSV import with column mapping |
| Growth | $29 | $290 | 5,000 products · 500,000 rows · unlimited fields | Everything in Starter, fitment table (also inside theme tabs), My Selection, universal products, import history with 5 backups |
| Pro | $99 | $990 | Unlimited | Everything in Growth, scheduled imports from a supplier feed, search analytics, priority support |

## Real app
- Configure the plans (monthly and yearly) in the Partner Dashboard (Managed Pricing). Plan buttons open Shopify's hosted page.
- Read the active plan from the `app_subscriptions/update` webhook / Admin API; enforce limits server-side (rows, linked products, field count) and show the meters from real counts.
- Dashboard setup step 5 ("Plan") is done once a subscription is active.
