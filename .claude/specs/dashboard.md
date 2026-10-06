# Dashboard

**Prototype:** `design/scripts/screens/dashboard.js` · Styles: `design/styles/dashboard-banner.css`, `design/styles/setup-guide.css` · **Suggested route:** `/app` (index)

## Purpose
Home screen. Explains the app in one glance, guides setup to "live", and shows four health numbers.

## Layout (top to bottom)
`s-page heading="Dashboard"` with no page actions (the banner and setup guide carry the actions).

### 1. Banner (custom, eye-catching)
- Deep navy → blue mesh gradient, soft sky/violet light, faint dot texture on the right.
- Left: category chip (icon + store type), heading = the store's search heading (e.g. "Find parts for your vehicle"), one-line description built from the field names, buttons **Add search to your store** (→ Storefront) and **Edit search fields** (→ Search fields).
- Right (300px): frosted-glass "How it works" panel — vertical timeline with 3 glowing outline icons:
  1. Shopper picks their {noun} — field names joined by ›
  2. FitFinder matches — `{rows} filter rows`
  3. Only {parts / accessories / products} that fit — "Fewer wrong orders and returns"
- Animation: steps fade up once on load; none if the user prefers reduced motion. Nothing loops.
- Phone: panel moves under the text.

### 2. Setup guide (custom, eye-catching)
- Header: progress ring (`{done}/5`, blue→violet stroke), title "Setup guide" (or "You're all set"), subtitle, collapse toggle (⌃/⌄).
- Segmented bar: 5 segments (4px high, 8px gap, so each sits above its step card); light tones: done = soft green #95DBB4, in progress = light theme colour (theme colour mixed 40% with white) filled halfway, to do = #EBEBEB. No gradients.
- 5 step cards in a row, content centred: soft round icon, status (DONE / IN PROGRESS / TO DO), name. Clicking a card selects it (blue border + light blue fill). Status always shows real progress; the selection only shows which step is being viewed.
- Detail panel: step title in dark text (#303030), weight 700.
- Step cards: all white. Every card has a 2px border (#E5E7EB); the selected card only changes that border to the theme colour (no background change). Done steps use Polaris success green: icon #29845A on #CDFEE1, "DONE" in #29845A.
- Detail panel (fixed height): small dot (theme accent; Polaris success green #29845A when done) before "STEP n · ABOUT x MIN" in muted grey text or "· COMPLETED", title, description (always exactly 2 lines reserved, clamped), primary CTA + "Next step", round ‹ › buttons, faint background icon.

| # | Card name | Done when | CTA → |
|---|---|---|---|
| 1 | Search setup | Always (created at onboarding) | Open search setup → Search setup |
| 2 | Import data | Shop has ≥ 1 filter row | Import data → Search setup, import card open at step 1 |
| 3 | Link products | Rows exist and none are unmatched | Review links → Product mapping |
| 4 | Go live | App embed is on | Open storefront settings → Storefront |
| 5 | Plan | Merchant chose a plan | Compare plans → Plans |

The guide opens on the first unfinished step.

### 3. Overview (at-a-glance cards)
Heading "Overview", then 4 small cards in one row (2 per row on phones), styled like Polaris cards (white background). Each card is just: label (12px), one number (20px, dark #303030) with an optional status badge, and one short specific line (11.5px, muted). The whole card is clickable. No icons, dividers, pills, chips or tips — keep it glanceable.

| Card | Number / badge | Line | Opens |
|---|---|---|---|
| Search on your store | Live / Off; "Hidden" (critical) when the live theme's app embed is off (My Selection and the code in theme tabs don't show; search sections already added keep working) | {n} of 4 blocks added | Storefront |
| Filter rows | row count | Distinct values of the first 3 list fields, e.g. "9 makes · 9 models" | Filter data |
| Unlinked SKUs | count; "Needs linking" (warning) when > 0 | {pct}% of SKUs linked | Product mapping |
| Products without filter data | count | Not shown in any search | Product mapping |

Not on the dashboard on purpose: search field count (shown in the banner) and plan (Shopify billing page).

## Data / backend
`GET /api/dashboard` → `{ storeType, heading, noun, fields[], rowCount, unmatchedCount, productsWithoutFitment, lastImportAt, embedEnabled, blocks{search,fitsBadge,fitmentTable,garage}, planChosen }`. App embed status comes from the theme's `settings_data.json` (Admin API) or is checked on demand.

## Build notes
- Banner and setup guide are custom components; everything else uses Polaris.
- Collapsed state of the guide should persist per shop (or per user).
