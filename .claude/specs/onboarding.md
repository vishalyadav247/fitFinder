# Onboarding

**Prototype:** `design/scripts/screens/onboarding.js` · **Suggested route:** `/app/onboarding` (shown when the shop has no search config yet)

## Purpose
First-run screen. The merchant says what their store sells; the app creates the default search fields and wording for that store type. A store has exactly one store type.

## Layout (top to bottom)
1. `s-page heading="Welcome to FitFinder"`, no sidebar menu while onboarding.
2. *(Only when changing type later)* `s-banner tone="warning"`: "Changing your store type replaces your search fields and filter data", with a link back to Settings.
3. `s-section`
   - `s-badge tone="info"` "Step 1 of 2" + heading "What kind of products does your store sell?"
   - Subdued paragraph: "We'll set up search fields that fit. You can rename, add or remove fields any time."
   - **Store type cards** (custom, eye-catching): 2×2 grid, radio group. Each card: pastel icon tile, name, one-line description, "Selected" badge on the chosen one.
4. `s-section heading="Your shoppers will search by"`
   - Field chips (neutral `s-badge`s joined by ›).
   - Text: `Your store will show “Search Widget” with {n} dropdowns.` (Something else shows an example instead.)
   - Primary button **Continue** (or **Replace my setup** when changing type).

## Store types and default fields
Source of truth: `design/scripts/data/store-types.js`.

| Store type | Default fields (type) | Shopper noun (word for products) | Saved selections name shoppers see |
|---|---|---|---|
| Automotive (car, motorcycle or truck parts — one kind per store, so no vehicle-type field) | Make (list) › Year (year range) › Model (list) | vehicle (parts) | My Selection |
| Phones and accessories | Brand › Series › Model (all lists) | phone (accessories) | My Selection |
| Beauty and personal care | Brand › Product type › Gender (all lists) | profile (products) — the shopper's brand / product type / gender | My Selection |
| Something else | Brand › Model (lists) | item (products) | My Selection |

## Behaviour
- Clicking a card selects it and updates the "search by" chips.
- **Continue** creates the search config + fields for the shop, then opens the Dashboard.
- **Replace my setup** (changing type) deletes existing fields and filter rows first. Ask for confirmation in the real app.

## Data / backend
- `POST /api/setup` `{ storeType }` → creates `search_configs` + `search_fields` rows (see [data-model.md](data-model.md)).
- The real app should not create sample rows.

## Build notes
- Store type cards: custom component (allowed: onboarding is one of the three custom areas).
- Use `s-badge`, `s-heading`, `s-paragraph`, `s-button`, `s-banner` for the rest.
