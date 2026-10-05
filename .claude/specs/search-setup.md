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

1. **Upload file** — `s-drop-zone` (.csv / .csv.gz, up to 100 MB) · **Download a CSV template** · `s-choice-list` "What should this import do?": *Add and update rows* (recommended; "New rows are added. Rows already in your data stay.") / *Replace all rows* / *Delete the rows listed in this file* ("Removes rows that match the file exactly. Rows not in the file stay.").
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
   | Add and update rows | Rows added · Unchanged · Errors | "Rows with errors are skipped. Everything else imports." ("For example an empty required field, or a year that can't be read.") + **Error report** | primary |
   | Replace all rows | Current rows deleted · Rows imported · Errors | "All current rows are deleted first" — download a backup from Import history + **Error report** | red (critical) → confirmation modal "Replace all {n} rows?" |
   | Delete the rows listed in this file | Rows deleted · Not found · Rows left | "Only exact matches are deleted" — every mapped column must match + **Not found report** | red (critical) → confirmation modal "Delete the rows listed in this file?" |
   Finishing closes the card, saves the mapping for next time, adds the file to Import history and shows a toast ("Import finished" / "Rows deleted").

   **No "Rows updated" count** (decided in M4): a filter row has no identity besides its content (field values, years and Attachment), so a changed row is a new row; the old one stays until it's deleted (Replace all, Delete listed rows, or Filter data). "Unchanged" = rows already in your data, including repeats within the file.
   While the check run reads the file, step 3 shows a spinner and "Checking your file… {n} rows read"; while importing, "Importing… You can leave this page; the import keeps running." Reopening Search setup during a running import shows the card with its progress. If a step fails, step 3 shows a critical banner "The import stopped" with the reason (nothing is changed).
   Reports are CSVs: Line, Problem, one column per field, Attachment. Error rows show what was in the file; Not found rows (delete) show the parsed row. The **Error report / Not found report** button shows only when there is something to report.
   **Download a CSV template**: one column per field (a Year range as one "2015-2020" column) and "Attachment", no rows.
   Error toasts (isError) in the card: "Choose a file to import." · "Choose a .csv or .csv.gz file." (also when a dropped file is refused) · "The file is larger than 100 MB." · "This file is empty." · "This file can't be read as a CSV." · "The upload couldn't start." · "The upload failed. Try again." · "The mapping couldn't be saved." · "The import couldn't start." · "The report couldn't be downloaded." · "An import is already running. Wait for it to finish." · "Something went wrong. Try again." A failed check run or import shows only the "The import stopped" banner with the reason (no toast); reasons include "The import stopped unexpectedly. Nothing was changed." (no progress for 3 minutes), "Your search fields changed. Map the columns again.", "This file has more than 2,000,000 rows. Split it into smaller files.", "This file is too large once unpacked. Split it into smaller files." and, for Replace all, "This file has no rows that can be imported, so Replace all rows would delete everything. Nothing was changed."
   Import history: **Download** is disabled when the file is no longer kept; "The file couldn't be downloaded." if it fails. While an import runs, field changes on this page show "An import is running. Change your fields when it has finished."
   Files: .csv or .csv.gz, up to 100 MB; comma, semicolon, tab or pipe separated; UTF-8 or Windows-1252. Plain .csv files over 1 MB are gzipped in the browser before upload; the Download in Import history returns the CSV as chosen. Year cells may be YYYY, MM/YY, MM/YYYY, DD-MM-YYYY, "/" or empty (no bound); a range column may be "2008-2011", "2016-" or "2016".

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
- Import history: the Search setup loader returns the 5 newest completed imports; `GET /api/imports/{id}/file` downloads the original upload (`?report=1` the report). Keep the original file of the last 5 imports per shop in object storage; delete older files when a 6th import finishes. Starting a new import cancels an unfinished one; Cancel import and leaving the page delete its file.
- Fields: route loader/action of `/app/search-setup` (form `intent` = add / label / placeholder / type / required / move / delete, zod-validated); ordered list `{ id, label, placeholder, type, required, position }`. A placeholder is stored empty when it equals the default, so renaming a field updates its default placeholder. Limits: field name 60 characters, placeholder 80.
- Import (M4): `POST /api/imports` `upload-target` → browser PUTs the file (presigned R2 URL, or `/api/uploads` locally) → `POST /api/imports` `create` (reads the first rows; mapping pre-filled from `import_mappings`, then header names) → `POST /api/imports/{id}` `map` (queues the check run) → poll `GET /api/imports/{id}` → `POST /api/imports/{id}` `run` (queues the import) → poll. Both steps are pg-boss jobs; rows are staged in `import_rows` so the Review counts and the result match.

## Build notes
Plain Polaris only (the preview table is a plain HTML table inside a scroll box because Polaris has no grid with a select in each header). Label changes must also update storefront labels (see [settings.md](settings.md)).
