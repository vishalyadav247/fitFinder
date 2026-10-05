// Filter rows: display, the add/edit form and the export CSV (specs/fitment-data.md). Pure; shared
// by the server and the Filter data page.
import type { FieldType } from "@prisma/client";
import { cleanValue, parseYearRangeCell } from "../import/clean";
import { MAX_ATTACHMENT_LENGTH, MAX_VALUE_LENGTH } from "../import/transform";

export interface RowField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
}

/** A row as sent to the browser (ids are BigInt in the database). */
export interface RowView {
  id: string;
  values: Record<string, string>;
  yearFrom: number | null;
  yearTo: number | null;
  attachment: string;
  linked: boolean;
}

/** Years as the import reads them back: "2008-2011", "2016-" (open), "2016" (one year), "". */
export function yearsText(from: number | null, to: number | null): string {
  if (from === null) return "";
  if (to === from) return String(from);
  return `${from}-${to ?? ""}`;
}

/** Years in the table (prototype showValue): "2008 – 2011", "2016 – now", "2016", "—". */
export function yearsDisplay(from: number | null, to: number | null): string {
  if (from === null) return "—";
  if (to === from) return String(from);
  return `${from} – ${to ?? "now"}`;
}

/** One cell's text for a field, as the import reads it. */
export function cellText(field: RowField, row: RowView): string {
  return field.type === "year_range"
    ? yearsText(row.yearFrom, row.yearTo)
    : (row.values[field.id] ?? "");
}

export function cellDisplay(field: RowField, row: RowView): string {
  return field.type === "year_range"
    ? yearsDisplay(row.yearFrom, row.yearTo)
    : row.values[field.id] || "—";
}

/** Confirmation text for one row: "SKU X (Audi · 2008 – 2011 · A4)". */
export function rowSummary(fields: RowField[], row: RowView): string {
  return `SKU ${row.attachment} (${fields.map((f) => cellDisplay(f, row)).join(" · ")})`;
}

/** Most rows one bulk delete or "Selected rows" export takes. */
export const MAX_SELECTED = 5000;

export const ATTACHMENT_KEY = "attachment";

export interface RowInput {
  values: Record<string, string>;
  yearFrom: number | null;
  yearTo: number | null;
  attachment: string;
}

export type RowParse =
  | { ok: true; row: RowInput }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * The add/edit form → a row, with the import's rules: values cleaned and cut like imported cells,
 * a Year range read like a range cell ("2015-2020", "2019-", "2016"), SKU and required fields
 * filled. `form` holds one entry per field id plus "attachment".
 */
export function parseRowForm(
  form: Record<string, string | undefined>,
  fields: RowField[],
  now = new Date(),
): RowParse {
  const fieldErrors: Record<string, string> = {};
  const values: Record<string, string> = {};
  let yearFrom: number | null = null;
  let yearTo: number | null = null;

  for (const f of fields) {
    const text = cleanValue(form[f.id]);
    if (f.type === "year_range") {
      const r = parseYearRangeCell(text, now);
      if (!r.ok) {
        fieldErrors[f.id] = "Enter a year or a range like 2015-2020 or 2019-";
        continue;
      }
      yearFrom = r.from;
      yearTo = r.to;
      if (f.required && r.from === null) fieldErrors[f.id] = `Enter ${f.label}`;
      continue;
    }
    if (text.length > MAX_VALUE_LENGTH) {
      fieldErrors[f.id] = `Use ${MAX_VALUE_LENGTH} characters or fewer`;
    } else if (text) {
      values[f.id] = text;
    } else if (f.required) {
      fieldErrors[f.id] = `Enter ${f.label}`;
    }
  }

  const attachment = cleanValue(form[ATTACHMENT_KEY]);
  if (!attachment) fieldErrors[ATTACHMENT_KEY] = "Enter a SKU";
  else if (attachment.length > MAX_ATTACHMENT_LENGTH) {
    fieldErrors[ATTACHMENT_KEY] =
      `Use ${MAX_ATTACHMENT_LENGTH} characters or fewer`;
  }

  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return { ok: true, row: { values, yearFrom, yearTo, attachment } };
}

/** Export column for the attachment; the import template uses the same name. */
export const ATTACHMENT_COLUMN = "Attachment";

/**
 * CSV cell. Text a spreadsheet would run as a formula gets a leading apostrophe; the import
 * removes it again (unescapeCell), so an export imports back unchanged.
 */
export function csvCell(v: unknown): string {
  let s = `${v ?? ""}`;
  // Also guard text that already looks guarded ("'=x"), so the import's unescape removes
  // exactly the apostrophe added here.
  if (/^'*[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(",") + "\r\n";
}

/** Export header: one column per field (a Year range as one "2015-2020" column) + Attachment. */
export function exportHeader(fields: RowField[]): string {
  return csvLine([...fields.map((f) => f.label), ATTACHMENT_COLUMN]);
}

export function exportLine(fields: RowField[], row: RowView): string {
  return csvLine([...fields.map((f) => cellText(f, row)), row.attachment]);
}
