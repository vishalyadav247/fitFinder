# Filter data

**Prototype:** `design/scripts/screens/fitment-data.js` · Styles: `design/styles/fitment-data.css` · **Suggested route:** `/app/filter-data` (import flow at `/app/filter-data/import`)

## Purpose
Everything about the filter rows on one page, with no tabs: browse and edit rows, import a CSV, and export. There is no import history list.

## Layout
`s-page heading="Filter data"` · primary **Import CSV** (→ Search setup, import card open) · secondary **Export** (opens the export modal).

1. Warning `s-banner` only when some SKUs are unlinked: "{n} SKUs aren't linked to a product" — "Shoppers won't see these rows in search results until they're linked to a product." + button **Link products** (→ Product mapping) on the right of that text, same row (`s-grid 1fr auto`). No summary cards: the row count is in the table footer.
2. Rows section (below).
3. **Clean up** card (full width), heading with a small eraser icon (`s-icon type="eraser"` in a soft grey tile).

### Rows
- `s-search-field` (filters live as you type across all field values and SKU) + **Add row**.
- **Add row** opens a modal (`s-modal id="row-modal"`, heading "Add row"): one `s-text-field` per search field in a 2-column grid (year range hint `2015-2020 or 2019-`) + SKU (required); primary **Add row**, secondary **Cancel**.
- `s-table`: Select checkbox · one column per search field · SKU · Product (`Mapped` success / `Unmatched` warning badge) · actions: **Edit** (pencil) and **Delete** (critical).
- **Edit** opens the same modal titled "Edit row", filled with the row's values; primary **Save changes**, secondary **Cancel**. If the row is linked, a note says changing the SKU unlinks it. Toast "Row updated".
- Selecting rows shows a bar: "{n} selected", **Clear selection**, **Export selected** (opens the export modal with Selected rows chosen), **Delete selected** (critical, confirms first).
- Footer: "{n} rows" or "{x} of {n} rows match".
- Empty state: "No rows yet" + **Import CSV** (→ Search setup import card). The prototype also shows **Restore sample rows (prototype only)**.
- **Clean up** card: **Remove duplicates** (exact duplicates, keep one; confirms first); **Delete all rows** (critical, confirms first).

### Import
**Import CSV** opens the 3-step import card (Upload file › Map columns › Review and import) on the [Search setup](search-setup.md) page. There is no separate import screen.

### Export modal (`s-modal id="export-modal" heading="Export filter data"`)
- Note: "The file uses the same columns as the import, so you can edit it and import it again."
- `s-choice-list` "What to export": **All rows ({n})** / **Selected rows ({n})** (disabled with "Select rows in the table first" when nothing is selected; pre-selected when rows are selected) / **Only rows with unlinked SKUs ({n})**. The empty template is not here; it is in the import flow.
- "Format: CSV (UTF-8)".
- Primary **Export CSV** (downloads and closes), secondary **Cancel**. Opened with `commandFor="export-modal" command="--show"`.

### Delete confirmations
Every delete opens a small `s-modal` first (shared `confirm-modal`): title, one sentence saying what will be removed and that it can't be undone, a red primary button and **Cancel**.

| Action | Title | Button |
|---|---|---|
| Row delete icon | Delete this row? (body names the SKU and its values) | Delete row |
| Delete selected | Delete {n} rows? | Delete {n} rows |
| Delete all rows | Delete all filter rows? | Delete all rows |
| Remove duplicates | Remove {n} duplicate rows? (when none: "No duplicate rows" with only **Close**) | Remove {n} rows |

### Notifications
Shopify toasts (App Bridge `shopify.toast.show`): "Row added", "Row updated", "Row deleted", "{n} rows deleted", "{n} duplicate rows removed", "All filter rows deleted", "Import finished", "Exported {n} rows". No success banners on this page.

## Data / backend
- `GET /api/fitment?query=&page=` (paginate; real shops can have 700k+ rows).
- `POST /api/fitment` (add row), `PUT /api/fitment/{id}` (edit row), `DELETE /api/fitment` `{ ids[] }`, `DELETE /api/fitment/all`, `POST /api/fitment/dedupe`.
- Import: see [search-setup.md](search-setup.md).
- `GET /api/fitment/export?scope=all|selected|unmatched&ids=` (stream CSV).

## Build notes
Plain Polaris. No tabs on this page. The export options live in an `s-modal`.
