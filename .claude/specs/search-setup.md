# Search setup

**Prototype:** `design/scripts/screens/search-setup.js` · **Suggested route:** `/app/search-setup`

## Purpose
One page for the search data: the dropdowns shoppers use, and importing the CSV that fills them. Fields are fully dynamic (rename, add, remove, reorder any time). Which file column fills which field is chosen **during each import** (step 2), never on the fields themselves. No separate import page and no import popups.

## Layout
`s-page heading="Search setup"` (nav item **Search setup**) · no primary action (imports start from **Import new file** in Import history) · secondary **Change store type** with `icon="store"` (→ onboarding in "change" mode).

1. **Fields shoppers pick** (`s-section padding="none"`)
   - Heading + subdued "{store type} · Shoppers pick these in this order. When you import a CSV, you choose which column fills each field."
   - One line per field, edited in place (saves on change, no popup). Laid out as a grid with fixed column widths (not `s-table`, which spreads columns across the width and leaves the inputs narrow): order 44px · name and placeholder share the free space · type 150px · required 100px · actions 116px. On phones the type, required and actions drop under the name.
     **Order** (neutral number badge) · **Field name** (`s-text-field`) · **Placeholder** (`s-text-field`, the text in the empty dropdown on the storefront; default "Select {field name}", e.g. "Select make"; cleared → back to the default) · **Type** (`s-select`: Dropdown / Year range) · **Required** (`s-checkbox`) · **Actions** (tertiary icons: move up, move down, delete — delete confirms first).
   - Footer: **Add field** (adds a "New field" line, Dropdown, not required; toast "Field added. Map a column to it on your next import.") + store-type hint (e.g. "For example Engine, Trim or Body type").
2. **Import history** (`s-section padding="none"`) — "We keep your last 5 files, so you can download a backup any time. A new import removes the oldest one." + **Import new file** (primary, `icon="upload"`).
   - `s-table`: **File** (newest has a success badge **Current**) · **Imported** · **Import type** · **Rows** · **Backup** (tertiary **Download**, the original file as uploaded; toast "Downloaded {file}").
   - While importing, this card is replaced by the **Import CSV card** (`s-section heading="Import CSV"`, see Import below), and the page scrolls to it.

No live preview and no search heading here: both live on [Storefront](storefront.md).

### Import (card on this page, 3 steps with the small stepper)
Opened by **Import new file** in Import history, **Import CSV** on Filter data and the setup guide's "Import data" step. Footer: **Back** (steps 2–3) on the left; **Cancel import** + primary **Next** (steps 1–2) / **Start import** (step 3) on the right. Leaving the page cancels the import.

1. **Upload file** — `s-drop-zone` (.csv / .csv.gz, up to 100 MB) · **Download a CSV template** · `s-choice-list` "What should this import do?": *Add and update rows* (recommended) / *Replace all rows* / *Delete the rows listed in this file* ("Removes rows that match the file exactly. Rows not in the file stay.").
2. **Map columns** (EasySearch-style column mapping)
   - "Map the columns in your file to your search fields (Make / Year / Model) and the Attachment." + subdued "Columns you don't map are ignored. The first rows of your file are shown below. We filled in the mapping from your last import."
   - `s-checkbox` **Column titles in the first row** (on by default; off = the first row is treated as data).
   - Preview table, scrolls sideways: a **Map column** `s-select` above every column, then the column titles row, then the first 3 rows.
   - Options are exactly the search fields plus **Attachment**: **Map column** (ignore) · Make · Year · Model … · **Attachment** (what each row links to: a product SKU, a product link or a collection link).
   - `s-checkbox` **Look for SKUs in the Attachment column** (on by default) — "Check it if the Attachment column has product SKUs. It can make the import take longer. Leave it off for product or collection links."
   - Each option belongs to one column, except a **Year range** field, which takes one column (ranges like 2015-2020) or two columns (left = from, right = to). Picking an option on one column too many resets the oldest one to Map column. A subdued line under the table explains the Year rule.
   - Pre-filled from the last import's mapping, then by header name.
   - **Next** without an Attachment column shows critical banner "Map the Attachment column" and stays on the step.
   - Subdued "Missing a field? Add it under Fields shoppers pick, then map a column to it."
3. **Review and import** — "{file} · {import type}", counts and a warning banner that depend on the import type:
   | Import type | Counts | Banner | Start import button |
   |---|---|---|---|
   | Add and update rows | Rows added · Rows updated · Unchanged · Errors | "Rows with errors are skipped. Everything else imports." + **Error report** | primary |
   | Replace all rows | Current rows deleted · Rows imported · Errors | "All current rows are deleted first" — download a backup from Import history + **Error report** | red (critical) → confirmation modal "Replace all {n} rows?" |
   | Delete the rows listed in this file | Rows deleted · Not found · Rows left | "Only exact matches are deleted" — every mapped column must match + **Not found report** | red (critical) → confirmation modal "Delete the rows listed in this file?" |
   Finishing closes the card, saves the mapping for next time, adds the file to Import history and shows a toast ("Import finished" / "Rows deleted").

## Behaviour
- Changing a field's type keeps the saved mapping sensible: one column becomes a one-column year range and back; a "to" column is dropped.
- Only one field can be a **Year range** (filter rows hold one from–to range). Choosing it for a second field shows the error toast "Only one field can be a year range."
- Changing the type converts the filter data: Year range → Dropdown writes each row's years as text ("2008-2011", "2016-" for open, "2016" for one year); Dropdown → Year range parses that text back. If any value isn't a year or year range (also: reversed ranges like "2011-2008"), the change is refused with "{n} filter rows have a {Field} value that isn't a year or year range. Fix or delete them first." (singular: "1 filter row has … Fix or delete it first.").
- Edits save on change (no Save button, no toast); add and delete show toasts ("Field added. Map a column to it on your next import." / "Field deleted"). An emptied field name keeps the old name. The delete confirmation is `s-modal` "Delete the {Field} field?" — "Shoppers will no longer see the {Field} dropdown, and its values in your filter data won't be used. This can't be undone." — red **Delete field** + **Cancel**. The modal stays open (Delete field loading) until the delete succeeds; on failure it stays open and an error toast shows.
- Other error toasts: "You can have up to 20 fields." (hard cap until plan limits, M9); "This field no longer exists."; "Set up your store first."; "This change took too long for the amount of filter data and was cancelled. Nothing was changed."; "That change couldn't be saved." / "… Try again.".
- After every save, the inputs show what was saved (an emptied name shows the old name again, a cleared placeholder shows the default, a refused type change reverts), except the input that has focus.
- Deleting a field drops its columns from the saved mapping and removes its values from the filter rows; rows that become identical are merged.
- Cascading on the storefront: each dropdown only offers values that exist for the choices above it.

## Data / backend
- Import history: `GET /api/imports?limit=5` and `GET /api/imports/{id}/file` (signed download of the original upload). Keep the original file of the last 5 imports per shop in object storage; delete older files when a 6th import finishes.
- Fields: route loader/action of `/app/search-setup` (form `intent` = add / label / placeholder / type / required / move / delete, zod-validated); ordered list `{ id, label, placeholder, type, required, position }`. A placeholder is stored empty when it equals the default, so renaming a field updates its default placeholder. Limits: field name 60 characters, placeholder 80.
- Import history and the import card are built in M4 (they need the import pipeline); until then the page shows only the fields card.
- Import: `POST /api/imports` (upload; returns columns + first rows, mapping pre-filled from `import_mappings`) → `PUT /api/imports/{id}/mapping` → `GET /api/imports/{id}/preview` (counts, errors) → `POST /api/imports/{id}/run`. Background job with progress. Reuse the Bilstein NL streaming importer (50k-row batches, gzip).

## Build notes
Plain Polaris only (the preview table is a plain HTML table inside a scroll box because Polaris has no grid with a select in each header). Label changes must also update storefront labels (see [settings.md](settings.md)).
