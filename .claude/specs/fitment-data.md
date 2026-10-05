# Filter data

**Prototype:** `design/scripts/screens/fitment-data.js` · Styles: `design/styles/fitment-data.css` · **Route:** `/app/filter-data` (built in M5; Import CSV opens the import card on Search setup via `/app/search-setup?import=1`)

## Purpose
Everything about the filter rows on one page, with no tabs: browse and edit rows, import a CSV, and export. There is no import history list.

## Layout
`s-page heading="Filter data"` · primary **Import CSV** (→ Search setup, import card open) · secondary **Export** (opens the export modal).

1. Warning `s-banner` only when some SKUs are unlinked: "{n} SKUs aren't linked to a product" — "Shoppers won't see these rows in search results until they're linked to a product." + button **Link products** (→ Product mapping) on the right of that text, same row (`s-grid 1fr auto`). No summary cards: the row count is in the table footer.
2. Rows section (below).
3. **Clean up** card (full width), heading with a small eraser icon (`s-icon type="eraser"` in a soft grey tile).

### Rows
- `s-search-field` + **Add row**. The search runs on the server 300 ms after typing stops, across all field values, the years (as `2008-2011`) and the SKU; the table shows 50 rows per page, newest first, with `s-table` pagination (shops can have 700k+ rows).
- **Add row** opens a modal (`s-modal id="row-modal"`, heading "Add row"): one `s-text-field` per search field in a 2-column grid (year range hint `2015-2020 or 2019-`) + SKU (required); primary **Add row**, secondary **Cancel**.
- `s-table`: Select checkbox · one column per search field · SKU · Product (`Mapped` success / `Unmatched` warning badge) · actions: **Edit** (pencil) and **Delete** (critical).
- **Edit** opens the same modal titled "Edit row", filled with the row's values; primary **Save changes**, secondary **Cancel**. If the row is linked, a note says changing the SKU unlinks it. Toast "Row updated".
- Selecting rows shows a bar: "{n} selected", **Clear selection**, **Export selected** (opens the export modal with Selected rows chosen), **Delete selected** (critical, confirms first).
- Add/edit follows the import's rules: values are cleaned like imported cells, the Year range is read like a range cell, the SKU and every required field must be filled. Problems show on the fields: "Enter {field}", "Enter a SKU", "Enter a year or a range like 2015-2020 or 2019-", "Use 255 characters or fewer". A row equal to another one is refused with an error toast ("This row already exists." / "Another row already has these values.").
- Selection is kept across pages and searches, up to 5,000 rows ("You can select up to 5,000 rows at a time.").
- Footer: "{n} rows" or "{x} of {n} rows match".
- Empty state: "No rows yet" + **Import CSV** (→ Search setup import card). The prototype also shows **Restore sample rows (prototype only)**; the app leaves it out.
- **Clean up** card: **Remove duplicates**: rows that are the same as an older row apart from upper/lower case and spaces in the values and the SKU (same years); the oldest of each is kept (decided 2026-10-05: exact copies can't exist because rows are unique per shop by their content hash). Card text: "Deletes rows that are the same apart from upper/lower case and spaces, keeping one of each." The button counts first (loading), then opens the confirmation. **Delete all rows** (critical, confirms first; disabled when there are no rows).

### Import
**Import CSV** opens the 3-step import card (Upload file › Map columns › Review and import) on the [Search setup](search-setup.md) page. There is no separate import screen.

### Export modal (`s-modal id="export-modal" heading="Export filter data"`)
- Note: "The file uses the same columns as the import, so you can edit it and import it again."
- `s-choice-list` "What to export": **All rows ({n})** / **Selected rows ({n})** (disabled with "Select rows in the table first" when nothing is selected; pre-selected when rows are selected) / **Only rows with unlinked SKUs ({n})**. The empty template is not here; it is in the import flow.
- "Format: CSV (UTF-8)".
- Primary **Export CSV** (downloads and closes), secondary **Cancel**. The page's title-bar **Export** and **Export selected** open it with `shopify.modal.show('export-modal')` (title-bar `commandFor` is documented for menus only).

### Delete confirmations
Every delete opens a small `s-modal` first (shared `confirm-modal`): title, one sentence saying what will be removed and that it can't be undone, a red primary button and **Cancel**.

| Action | Title | Button |
|---|---|---|
| Row delete icon | Delete this row? (body names the SKU and its values) | Delete row |
| Delete selected | Delete {n} rows? | Delete {n} rows |
| Delete all rows | Delete all filter rows? | Delete all rows |
| Remove duplicates | Remove {n} duplicate rows? Body: "Rows that are the same as another row apart from upper/lower case and spaces will be removed. One of each is kept. This can't be undone." (when none: "No duplicate rows" with only **Close**) | Remove {n} rows |

### Notifications
Shopify toasts (App Bridge `shopify.toast.show`): "Row added", "Row updated", "Row deleted" (row icon), "{n} rows deleted" (Delete selected), "{n} duplicate rows removed", "All filter rows deleted", "Import finished", "Exported {n} rows". No success banners on this page.

Error toasts: "Rows couldn't be loaded. Try again.", "This search took too long. Try a longer or more exact search.", "The export failed. Try again.", "An import is running. Try again when it has finished.", "Your filter data is being changed right now. Try again in a moment.".

## Data / backend (as built, M5)
- `GET /api/fitment?q=&page=`: one page of 50 rows (+ `hasNextPage`, and `matching` when searching). Search reads time out after 8 s.
- Page loader: fields + counts (rows, rows with unlinked SKUs, unlinked SKUs). A row is linked when `product_links` has its attachment.
- Route action on `/app/filter-data`, intents `add`, `edit` (`rowId`), `delete` (`ids` JSON, `single`), `delete-all`, `dedupe-count`, `dedupe`. Writes take the shop's setup lock (like field changes and imports) and are refused while an import runs.
- Import: see [search-setup.md](search-setup.md).
- `POST /api/fitment/export` `{ scope: all|selected|unmatched, ids? }`: streams a UTF-8 CSV (with BOM), header = field labels + `Attachment` (same as the import template; the table calls it SKU), one `2015-2020` / `2019-` / `2016` column per Year range. `X-Row-Count` header; files `filter-data.csv`, `filter-data-selected.csv`, `filter-data-unlinked.csv`. Cells starting with `= + - @` get a leading `'`; the import removes it, so an export imports back unchanged.

## Build notes
Plain Polaris. No tabs on this page. The export options live in an `s-modal`.
