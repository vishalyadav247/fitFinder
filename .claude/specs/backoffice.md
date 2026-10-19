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
  - Under the label "Manage", the nav items **Overview**, **Plans**, **Stores**, **Logs** and **Profile**. The active item is highlighted, and Plans also stays active on its edit pages. Signing in lands on Overview. A new section is one entry in `NAV` in `app/routes/backoffice.tsx`.
  - At the bottom, the admin's avatar letter and name (or email) and **Sign out**.
- **Contextual save bar (Shopify admin style):** edit pages have no buttons at the bottom.
  - As soon as a field changes, a bar appears at the top with "Unsaved changes", **Discard** and **Save**. While saving, it shows "Saving…" with a spinner.
  - **Discard** puts back the saved values.
  - Leaving with unsaved changes (nav, back link, browser back) is blocked and the bar shakes. Closing the tab asks first.
- **Toasts (Shopify admin style):** shown at the bottom centre in a dark pill with ×.
  - Success toasts hide after 5 s; errors are red and hide after 8 s.
  - Saves show "{Plan} saved" or "Profile saved".
  - Errors show "Check the highlighted fields." or the server's message, with the field errors under the fields.

- **Error page:** a backoffice page that fails shows the backoffice's own glass card, "Something went wrong" / "This page couldn't be loaded. Try again; if it keeps happening, the error is in Logs." (or "Page not found" / "This backoffice page doesn't exist.") with **Back to Overview**, not the merchant-facing app message.

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
   - **Trials ending in 7 days:** up to 8 rows (domain, plan, "Ends {date}"), or "No trials end in the next 7 days."
   - **Recent activity:** the last 10 events of the past 30 days, newest first: "Installed SpareFit", "Uninstalled SpareFit", "Started {plan}" and "Left {plan}". Each row has a coloured dot, the domain and "{n} h ago" (the exact UTC time on hover). With no events: "Nothing happened in the last 30 days."
3. **Plans** (`/backoffice/plans`; was `/backoffice` until 2026-10-14, and the app-wide numbers moved to Overview):
   - The title "Plans" and "Prices, free trials, limits and features merchants see on the Plans page."
   - One glass card per plan:
     - Name and description.
     - Badges: "Default" on the plan used by stores without a plan, and "Shown" or "Hidden". A hidden plan's card is dimmed.
     - Price: "Free", or "$29 / month" with "$290 / year · 14 days free trial" under it ("Monthly only" / "No trial" when not set).
     - The card's lines as one bulleted list, exactly as merchants see them on the Plans page (`cardLines`: limits, "Up to 10 search fields", features and the plan's own lines in their places; changed 2026-10-19 from limit rows and feature chips).
     - "{n} stores" and a small pencil icon. The whole card opens Edit plan (2026-10-19; the plan name is the link and stretches over the card, keyboard focus outlines the card); a spinner replaces the pencil while it opens.
4. **Stores** (`/backoffice/stores`, after Plans in the nav; added 2026-10-15, product owner): every store, from `storeList` in `app/models/backoffice-stats.server.ts`. Read-only. After the store type ("Automotive · Logs"), a **Logs** link (labelled "Logs for {domain}") opens Logs filtered to that store (last 7 days). The domain link says "(opens in a new tab)" to screen readers.
   - Header: "Stores" and "Every store with SpareFit: its plan, search fields and how much it uses them."
   - One glass card with the filters, the table and the footer:
   - **Filters** (in the URL, so a view can be bookmarked; a GET form): "Search by domain" (applies 350 ms after typing), Status (**Installed** default / Uninstalled / All stores), Plan (All plans / each plan / No plan picked yet), Sort (**Newest installs** default / Last active / Domain A–Z). A changed filter goes back to page 1; odd URL values fall back to the defaults, and a page past the end shows the last page.
   - **Columns:** Store (domain, a link to the storefront in a new tab, with the store type under it or "Not set up yet") · Plan (plan badge, "No plan", or red "Uninstalled {date}"; plus "Trial · ends {date}" while in a trial) · Search fields (the field names in order, "Make › Year › Model"; "—" before onboarding) · Filter rows · Linked SKUs · Searches (30 d) · Installed (date) · Last active (last admin visit, "{n} h ago"). Uninstalled rows are dimmed.
   - The counts are read only for the stores on the page (a big catalog doesn't slow the list).
   - **Footer** (the paged-table standard): "Showing x–y of n" left, ‹ Page n of m › centred, Rows per page 10 / 25 / 50 right.
   - Empty: "No stores have SpareFit installed yet.", or "No stores match these filters." when filtered.
5. **Logs** (`/backoffice/logs`, after Stores in the nav; added 2026-10-15, product owner): the app's errors, warnings and slow requests, to understand performance and debug. Read-only, apart from the retention.
   - **What is logged** (`app/services/logs/`):
     - Every `console.error` (**Error**) and `console.warn` (**Warning**) of the web server and the job worker; they still print to the server console. "area: what happened" messages give the source ("storefront", "import"…), otherwise "app". The shop is read from the logged values (`shop`, `domain`…, or `shopId`, looked up when the entry is saved).
     - Errors no route handled (`handleError` in `entry.server.tsx`: "route: unhandled error" with the method and path); requests the browser cancelled are left out.
     - **Slow requests:** the root route's middleware (`v8_middleware`) times every request (pages, data requests, API, app proxy, webhooks); slower than `LOG_SLOW_MS` (default 3,000 ms) → "Slow request: {METHOD} {path}" with the duration. Uploads and file downloads are left out (slow because of their size). The shop is named only for successful (2xx) requests to routes that verify the caller (`/app`, `/api`, `/proxy`, `/webhooks`). Only the path is kept, never the query string. Bots are left out (their pages render fully before the response).
     - Framework and dev-server notices are ignored. `LOG_CAPTURE=false` turns capture off.
   - **Privacy and safety:** access and session tokens, bearer values, passwords and secrets (also `client_secret`, `…_API_SECRET`, escaped JSON), whole cookie headers, signatures and HMACs, URL credentials (`user:pass@`), OAuth `code` / `state` / `session` URL parameters, shopper ids (`logged_in_customer_id`), IP addresses and email addresses are removed before saving; error codes (Prisma `P2002`) stay readable. Messages are cut at 500 characters, details at 8,000. Saving runs in the background and never holds up or fails the request; at most 200 entries wait, more are dropped and reported as one warning.
   - **Grouping:** the same level, source, message, store, request path and error (type + first line; numbers ignored) within an hour is one row with **Times**, first and last seen; slow requests keep the slowest duration.
   - **Header:** "Logs", "Errors, warnings and slow requests from the app and its background jobs." and, on the right, **Keep logs for** 7 days / 14 days (default) / 1 month (Origin-checked post).
     - A longer period saves at once (nothing is deleted).
     - A shorter one asks first (confirm every delete): a dialog "Keep logs for {n}?", "Entries last seen more than {n} ago will be deleted now. This can't be undone.", **Cancel** (focused; Esc too) and red **Delete older entries**. Cancel puts the select back.
     - Saved: toast "Logs are kept for {n}" (+ " · {n} older entries deleted"). Refused: red toast "Choose 7, 14 or 30 days." and the select goes back to the saved value.
   - **Level tabs** with counts for the current store, time and search: **All**, **Errors**, **Warnings**, **Slow requests**.
   - **Filters** (in the URL): "Search messages, sources and paths" (350 ms after typing), Store (**All stores** / App-wide (no store) / each store with entries, most recent first), Time (Last hour / **Last 24 hours** / Last 7 days / Everything kept). Odd URL values fall back to the defaults; a page past the end shows the last page.
   - **Table:** Level (red Error with an alert icon, amber Warning with an info icon, blue Slow request with a clock icon) · Message (source and duration under it) · Store ("App-wide" when none) · Times · Last seen ("{n} h ago", exact UTC time on hover), newest first. Durations show as "{n.n} s". Clicking a message (a button with `aria-expanded`) opens its details under the row: **First seen**, **Last seen** (UTC), **Times**, **Request** and **Slowest** (when known), then the logged details (stack, values) in a scrolling monospace box, or "No more details were logged."
   - Filter fields follow the URL (opening Logs from the nav shows the defaults again).
   - Footer: the paged-table standard (shared `TableFooter`).
   - Empty: "Nothing logged in the last 24 hours. All quiet." (the chosen time), "No errors, warnings or slow requests. All quiet." (everything kept), or "No log entries match these filters."
   - **Deleting:** every night in the daily purge job (03:15 UTC), entries last seen before the retention, in batches of 5,000; a purged store's entries are deleted with the store (`purge.server.ts`). The store filter lists stores with entries in the chosen time.
6. **Edit plan** (`/backoffice/plans/{key}`; "Plans" in the title goes to `/backoffice/plans`):
   - Header: the title "Plans › Edit {plan}" ("← Plans" is a link in the title's font, accent colour with an underline; 2026-10-19, replaced the small "← Plans" link above the title) and "Changes to limits and features apply right away. Price and trial changes apply to new subscriptions."
   - Sections in glass cards, with toggle switches instead of checkboxes:
     - **General:** Name (max 40), Description (max 160; one line on the card), and "Show this plan to merchants". Hidden plans can't be picked; stores already on them keep them. At least one plan must stay shown.
     - **Pricing and trial:**
       - The "Free plan" switch: no charge and no trial. Stores without a plan get the first free plan's limits.
       - When the plan isn't free:
         - Monthly price in USD, above 0.
         - Yearly price, optional (empty means monthly only; above 0 when set).
         - Free trial in days, 0–365, default 14. The days a store has already used are taken off.
     - **Limits** (left) and **Features** (right) side by side (2026-10-19; stacked on narrow screens). **Limits:** one box per limit, one per row, with a number (an empty box is refused) and an "Unlimited" switch. Search fields and import backups are not limits (simplified 2026-10-19): every store can have up to 10 search fields, and Import backups is a switch under Features that keeps the last 5 imports.
       - Filter rows
       - Linked products
       - Lowering a limit never deletes data.
     - **Features:** one switch per feature, each with its help text.
       - Fits badge
       - Fitment table
       - My Selection floating button
       - Universal products
       - Import backups ("Keeps the last 5 imported files to download.")
       - Custom CSS (Settings › Custom CSS; added 2026-10-16, off on every plan until switched on)
     - **Card lines** (2026-10-19): the plan card as merchants see it. Generated lines (limits and features, following the form as it is edited) show as dashed rows marked "Automatic". The plan's own lines are text boxes with **Move up**, **Move down** and **Remove line** icon buttons; moving past a generated line changes its place, moving past another own line swaps them. **Add line** adds an empty line at the bottom and focuses it (max 12 lines, 120 characters each; at 12 the button is off: "12 lines is the most a card can have."). Empty lines are dropped on save. Each own line is stored with its place (`plans.bullets_at`: generated lines before it).
   - **Validation:** zod `planInputSchema` (`app/services/plan-features.ts`). Errors appear under each field, plus the error toast.
   - **Saving:** a save returns to Plans (`/backoffice/plans?saved={key}`) with the toast "{Plan} saved".
7. **Profile** (`/backoffice/profile`):
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
