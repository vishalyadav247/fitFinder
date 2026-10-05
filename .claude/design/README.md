# FitFinder admin — UI prototype

A clickable prototype of the FitFinder embedded admin app (a Shopify public app for "find parts that fit" search). It is the reference for building the real app. Every screen has a spec in [`../specs/`](../specs/). To build the app, start with [`../CLAUDE.md`](../CLAUDE.md) and [`../BUILD-PLAN.md`](../BUILD-PLAN.md).

## Open it

Double-click `index.html`. It needs an internet connection because the Polaris web components load from Shopify's CDN. No build step and no server needed.

- The prototype starts at onboarding. Pick a store type and click **Continue**.
- Edits are saved in your browser (localStorage). **Settings → Start over** resets everything.
- All data is sample data. The first six automotive rows are real rows from the Bilstein NL CSV; everything else is made up.

## Files

```
design/
├── index.html                  Page shell: admin frame, sidebar, script and style tags
├── styles/
│   ├── tokens.css              Colours and base element styles
│   ├── admin-shell.css         Simulated Shopify admin frame and sidebar
│   ├── components.css          Small shared pieces (steppers, tabs, field grid, plans, toasts, section titles)
│   ├── dashboard-banner.css    Dashboard banner (custom, eye-catching)
│   ├── setup-guide.css         Dashboard setup guide (custom, eye-catching)
│   ├── fitment-data.css        Filter data page extras (bulk bar, row form grid)
│   ├── storefront.css          Storefront page and the shopper-facing previews
│   └── responsive.css          Phone and narrow-window layout (loaded last)
├── scripts/                    Classic scripts sharing one global scope, loaded in order
│   ├── core/theme.js           Prototype-only theme picker (loaded first)
│   ├── core/icons.js           Icon set, HTML escaping, id helper
│   ├── data/store-types.js     Store types, default search fields, sample rows, makeSetup()
│   ├── core/state.js           Prototype state and localStorage persistence
│   ├── core/fitment.js         Year ranges, row matching, cascading dropdown options
│   ├── core/navigation.js      App menu
│   ├── core/shared-ui.js       Field chips, confirmation modal, toast, placeholders, the S screen registry
│   ├── screens/*.js            One file per screen; each defines S.<screen> returning HTML
│   └── app.js                  render(), change/click handlers, boot
(specs live next to this folder: `.claude/specs/`)
```

## Screens

| Menu item | Prototype file | Spec |
|---|---|---|
| (first run) Onboarding | `scripts/screens/onboarding.js` | [`../specs/onboarding.md`](../specs/onboarding.md) |
| Dashboard | `scripts/screens/dashboard.js` | [`../specs/dashboard.md`](../specs/dashboard.md) |
| Search setup (search fields, CSV import with column mapping, import history) | `scripts/screens/search-setup.js` | [`../specs/search-setup.md`](../specs/search-setup.md) |
| Filter data (rows, export modal, clean up) | `scripts/screens/fitment-data.js` | [`../specs/fitment-data.md`](../specs/fitment-data.md) |
| Storefront | `scripts/screens/storefront.js` | [`../specs/storefront.md`](../specs/storefront.md) |
| Product mapping | `scripts/screens/product-mapping.js` | [`../specs/product-mapping.md`](../specs/product-mapping.md) |
| Settings | `scripts/screens/settings.js` | [`../specs/settings.md`](../specs/settings.md) |
| Plans | `scripts/screens/plans.js` | [`../specs/plans.md`](../specs/plans.md) |
| Data model and API | — | [`../specs/data-model.md`](../specs/data-model.md) |

## How the prototype code works

- Each screen is a function `S.<name>()` that returns an HTML string of Polaris web components (`s-page`, `s-section`, `s-table`, …).
- `render()` in `app.js` draws the current screen into `<main id="view">`.
- Buttons carry `data-go="<screen>"` (navigate) or `data-act="<action>"` (handled in the click `switch` in `app.js`). Form fields carry `data-act` and are handled in `onChange()`.
- Two Polaris quirks are handled in `render()`: `s-select` and `s-choice-list` ignore their initial `value`/`selected` until set as properties after render.

This is prototype code, not app code. In the real app the screens become React route components; see each spec's "Build notes" in `../specs/`.

## Design rules

1. **Polaris first.** Use Polaris web components everywhere, as Shopify recommends for embedded apps. Plain Polaris look for all screens. Section headings: write them as `<h2 class="sec-title">` (Polaris size, weight 750) instead of `s-section heading` / `s-heading`, because the Polaris heading text sits in shadow DOM and can't be made bolder; keep `accessibilityLabel` on the section.
2. **Only three custom, eye-catching areas:** the dashboard banner, the setup guide, and onboarding. Their styles live in `dashboard-banner.css`, `setup-guide.css` and the `.types` cards in `components.css`.
3. **Colours:** set by theme variables in `styles/tokens.css` (`--p*` primary, `--a*` accent, `--glow*` banner lights). **Chosen theme for the app: Sky** (light blue; 2026-10-05, in `app/styles/theme.css`). The prototype opens in Sky; alternatives Indigo & teal, Emerald, Plum & rose, Sunset (orange), Golden (yellow), Coral & pink, Crimson & rose, Teal & cyan, Sky (light blue), and the previous Blue & violet. Switch with the **Theme** picker in the prototype top bar. Green means done/fits, amber means "needs attention", whatever the theme.
4. **Narrow pages:** every page uses `s-page inlineSize="base"`.
5. **One store type per store.** A store picks Automotive, Phones and accessories, Beauty and personal care, or Something else at onboarding. Search fields are fully dynamic after that.
6. **Notifications:** after an action (saved, deleted, imported, exported, linked) show a Shopify toast — App Bridge `shopify.toast.show(message)`, `{ isError: true }` for errors. Use `s-banner` only for lasting states on a page (e.g. "Your search is hidden"). The prototype draws a toast look-alike (`showToast()` in `scripts/core/shared-ui.js`).
7. **Confirm every delete** with a small Polaris `s-modal` (red primary button + Cancel). Never delete on one click.
8. **No AI features.** Automatic matching is rule-based (header names, SKUs).

## What is simulated

| In the prototype | In the real app |
|---|---|
| Sample rows in the browser | Filter rows in the app database, per shop |
| Sidebar drawn by the page | Shopify admin sidebar via App Bridge `<s-app-nav>` |
| Import counts shown as `[added]`, `[errors]` … | Real counts from the import job |
| "Choose product" marks a row as linked | Shopify resource picker, then saved link |
| Storefront previews | Theme app extension blocks on the live theme |
| Plan buttons show a toast | Shopify Managed Pricing (hosted plan page) |
| Theme status, App embed switch, Add to theme | Theme editor deep links + reading the theme files |
| My Selection saved in the prototype state | Saved in the shopper's browser (localStorage) by the app embed |
