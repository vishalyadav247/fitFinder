# Backoffice (super admin)

**URL:** `/backoffice`, a separate web page outside the Shopify admin. **Prototype:** none; this internal tool isn't part of the merchant UI. Agreed 2026-10-13; redesigned and Profile added 2026-10-14.

It manages the plan catalogue (four plan slots, each with price, free or paid, trial days, limits, features and card lines) and the super admin's own profile. The merchant Plans page (`specs/plans.md`) and every limit check read the plans from here.

## Access
- **Credentials:** one super admin.
  - **First sign-in:** two env vars, `BACKOFFICE_EMAIL` and `BACKOFFICE_PASSWORD` (12+ characters). If either is missing, or the password is shorter, every `/backoffice` URL returns 404.
  - **After the first Profile save:** the `backoffice_admins` row is used instead (one row; password stored as a scrypt hash, hashed on the server). The env values then only keep the backoffice switched on.
  - Passwords are compared in constant time. Both the email and the password check always run.
- **Session:** a signed cookie `__sparefit_bo`: HttpOnly, Secure in production, SameSite=Strict, path `/`, 8 hours.
  - The path is `/` on purpose. React Router loads page data from `/backoffice.data`, which a cookie scoped to `/backoffice` doesn't cover; sign-in, save and back navigation then loop forever (bug fixed 2026-10-14).
  - The signing key is derived on the server (HMAC of the env credentials with `SHOPIFY_API_SECRET`).
  - The session stores the admin's `version`. Changing the email or password raises it, which signs out every other session. The session that saved gets a fresh cookie.
- **Forms:** every form post must carry an `Origin` header that matches this site; otherwise it gets 403.
- **Failed sign-ins:** at most 5 per IP and 50 in total per 15 minutes. Attempts are counted before the password check, so parallel guesses can't slip through. After that: "Too many failed sign-ins. Try again in 15 minutes."
- **Wording:** wrong credentials show "The email or password is wrong." It never says which one was wrong.
- **Privacy:** pages are `noindex`.

## Look and layout
- **Design:** dark glass panels (blur, light borders) over a deep gradient with slow-moving colour blobs (`app/styles/backoffice.css`). The pages use plain HTML; there are no Polaris web components or App Bridge, because those need the Shopify admin. Colour motion stops under reduced motion.
- **Left sidebar:** sticky.
  - At the top, the logo with "SpareFit · Backoffice".
  - Under the label "Manage", the nav items **Overview**, **Plans** and **Profile**. The active item is highlighted, and Plans also stays active on its edit pages. Signing in lands on Overview. A new section is one entry in `NAV` in `app/routes/backoffice.tsx`.
  - At the bottom, the admin's avatar letter and name (or email) and **Sign out**.
- **Contextual save bar (Shopify admin style):** edit pages have no buttons at the bottom.
  - As soon as a field changes, a bar appears at the top with "Unsaved changes", **Discard** and **Save**. While saving, it shows "Saving…" with a spinner.
  - **Discard** puts back the saved values.
  - Leaving with unsaved changes (nav, back link, browser back) is blocked and the bar shakes. Closing the tab asks first.
- **Toasts (Shopify admin style):** shown at the bottom centre in a dark pill with ×.
  - Success toasts hide after 5 s; errors are red and hide after 8 s.
  - Saves show "{Plan} saved" or "Profile saved".
  - Errors show "Check the highlighted fields." or the server's message, with the field errors under the fields.

## Screens
1. **Sign in** (`/backoffice/login`):
   - A glass card with the logo, the title "SpareFit backoffice" and the line "Sign in to manage plans.".
   - Email and Password fields and a **Sign in** button, which shows a spinner and "Signing in…" while busy.
   - Under the button, "Super admin only · sessions last 8 hours".
2. **Overview** (`/backoffice`, the backoffice home; added 2026-10-14): how SpareFit is doing across all stores. It is read-only. The numbers come from `overviewStats` in `app/models/backoffice-stats.server.ts`; these are app-wide counts and shop domains, never shoppers' data.
   - **Header:** "Overview", "How SpareFit is doing across all stores.", and "Updated just now".
   - **Four KPI tiles:**
     - **Installed stores**, with "+{n} in the last 30 days" under it.
     - **Monthly revenue:** active charges past their trial; a yearly charge counts as its price ÷ 12. Under it, "From {n} paying stores (yearly ÷ 12)".
     - **In free trial:** stores whose charge is still in its trial. Under it, "${x} / month once trials end", or "No stores in a trial".
     - **Uninstalls**, with "In the last 30 days" under it.
   - **Installs, last 30 days:** one bar per UTC day on a shared baseline, a dashed line at the highest value, and the first and last date under the chart. Hovering a bar shows "{date} · {n} installs". A hidden table gives the same numbers to screen readers. With no installs: "No installs in the last 30 days."
   - **Stores per plan:** a labelled bar per plan ("{name} (free)" on free plans) plus "No plan picked yet" in grey, with the count at the right, and a "Manage plans →" link.
   - **Setup progress:** of the installed stores, how many have:
     - Installed
     - Search set up (store type chosen)
     - Filter data added
     - Products linked

     Each shows a count and a percentage, with "Of the stores that have SpareFit installed now." under the bars.
   - **Imports, last 7 days:** Finished, Failed (red when above 0) and Rows added.
   - **Trials ending in 7 days:** up to 8 rows (domain, plan, "Ends {date}"), or "No trials end in the next 7 days."
   - **Recent activity:** the last 10 events of the past 30 days, newest first: "Installed SpareFit", "Uninstalled SpareFit", "Started {plan}" and "Left {plan}". Each row has a coloured dot, the domain and "{n} h ago" (the exact UTC time on hover). With no events: "Nothing happened in the last 30 days."
3. **Plans** (`/backoffice/plans`; was `/backoffice` until 2026-10-14, and the app-wide numbers moved to Overview):
   - The title "Plans" and "Prices, free trials, limits and features merchants see on the Plans page."
   - One glass card per plan:
     - Name and description.
     - Badges: "Default" on the plan used by stores without a plan, and "Shown" or "Hidden". A hidden plan's card is dimmed.
     - Price: "Free", or "$29 / month" with "$290 / year · 14 days free trial" under it ("Monthly only" / "No trial" when not set).
     - The four limits.
     - The included features as chips, or "No extra features".
     - "{n} stores", and an **Edit** button that shows a spinner while opening.
4. **Edit plan** (`/backoffice/plans/{key}`; "← Plans" goes to `/backoffice/plans`):
   - Header: "← Plans", the title "Edit {plan}" and "Changes to limits and features apply right away. Price and trial changes apply to new subscriptions."
   - Sections in glass cards, with toggle switches instead of checkboxes:
     - **General:** Name (max 40), Description (max 160; one line on the card), and "Show this plan to merchants". Hidden plans can't be picked; stores already on them keep them. At least one plan must stay shown.
     - **Pricing and trial:**
       - The "Free plan" switch: no charge and no trial. Stores without a plan get the first free plan's limits.
       - When the plan isn't free:
         - Monthly price in USD, above 0.
         - Yearly price, optional (empty means monthly only; above 0 when set).
         - Free trial in days, 0–365, default 14. The days a store has already used are taken off.
     - **Limits:** one box per limit, with a number (an empty box is refused) and an "Unlimited" switch. Search fields says "Up to the maximum (20)" instead.
       - Filter rows
       - Linked products
       - Search fields (never more than 20)
       - Import backups ("unlimited" lists up to 100)
       - Lowering a limit never deletes data.
     - **Features:** one switch per feature, each with its help text.
       - Fits badge
       - Fitment table
       - My Selection floating button
       - Universal products
       - Priority support (shown on the card only)
     - **Extra card lines:** one line per row (max 12, 120 characters each), shown after the generated lines.
   - **Validation:** zod `planInputSchema` (`app/services/plan-features.ts`). Errors appear under each field, plus the error toast.
   - **Saving:** a save returns to Plans (`/backoffice/plans?saved={key}`) with the toast "{Plan} saved".
5. **Profile** (`/backoffice/profile`):
   - The title "Profile" and "Your name, sign-in email and password."
   - While the env values are still the login, an info banner: "You're signed in with the email and password from the server settings. Save this page once to manage them here; after that, these values are used to sign in."
   - **Account:** Name (optional, max 80; shown in the sidebar) and Email ("You sign in with this email.").
   - **Change password:** New password ("Leave empty to keep it"; at least 12 characters) and Confirm new password ("The passwords don't match.").
   - **Confirm it's you:** Current password, needed for any save ("Your current password is wrong."). Changing the email or password signs out other sessions.
   - A save stays on Profile with the toast "Profile saved".

## Rules
- The four slot keys (`starter`, `growth`, `pro`, `business`) are fixed. Names, prices and everything else can be edited.
- New features need code: the registry in `plan-features.ts` plus the check where the feature is used. The backoffice only sets the values per plan.
- Plan saves lock the `plans` table, so the "at least one plan shown" rule can't be raced. They record `updated_by` (the admin email) and clear the plans cache. Other processes pick up the change within 30 seconds.
- Values the browser needs (such as the minimum password length) live in `app/services/backoffice-shared.ts`, never in a `.server` module. A client import of a `.server` module stops the page from becoming interactive.
