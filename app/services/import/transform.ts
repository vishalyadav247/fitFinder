// One file row → one staged filter row (or an error). Pure; used by the check run.
import {
  cleanValue,
  parseYearRangeCell,
  unescapeCell,
  yearsFromCells,
} from "./clean";
import type { MapField, ResolvedTarget } from "./mapping";

export interface StagedRow {
  values: Record<string, string>;
  yearFrom: number | null;
  yearTo: number | null;
  attachment: string;
  error: string | null;
  /** The mapped cells as read; kept for error rows (report). */
  raw: Record<string, string> | null;
}

// Long cells are cut so one bad file can't bloat the table or the storefront dropdowns.
export const MAX_VALUE_LENGTH = 255;
export const MAX_ATTACHMENT_LENGTH = 500;

export function buildRow(
  cells: string[],
  targets: (ResolvedTarget | null)[],
  fields: MapField[],
  now = new Date(),
): StagedRow {
  const values: Record<string, string> = {};
  let attachment = "";
  const yearCells = new Map<
    string,
    { range?: string; from?: string; to?: string }
  >();
  const raw: Record<string, string> = {};

  targets.forEach((t, col) => {
    if (!t) return;
    const cell = cells[col] ?? "";
    if (t.kind === "attachment") {
      attachment = unescapeCell(cleanValue(cell));
      raw.Attachment = cell;
      return;
    }
    const label = fields.find((f) => f.id === t.fieldId)?.label ?? t.fieldId;
    if (t.kind === "list") {
      const v = unescapeCell(cleanValue(cell));
      if (v) values[t.fieldId] = v.slice(0, MAX_VALUE_LENGTH);
      raw[label] = cell;
      return;
    }
    const y = yearCells.get(t.fieldId) ?? {};
    y[t.kind] = cell;
    yearCells.set(t.fieldId, y);
    raw[t.kind === "range" ? label : `${label} ${t.kind}`] = cell;
  });

  const fail = (error: string): StagedRow => ({
    values: {},
    yearFrom: null,
    yearTo: null,
    attachment: "",
    error,
    raw,
  });

  let yearFrom: number | null = null;
  let yearTo: number | null = null;
  for (const [fieldId, y] of yearCells) {
    const label = fields.find((f) => f.id === fieldId)?.label ?? fieldId;
    const r =
      y.range !== undefined
        ? parseYearRangeCell(y.range, now)
        : yearsFromCells(y.from, y.to, now);
    if (!r.ok) return fail(`${label} isn't a valid year or year range`);
    yearFrom = r.from;
    yearTo = r.to;
  }

  if (!attachment) return fail("Attachment is empty");
  if (attachment.length > MAX_ATTACHMENT_LENGTH) {
    return fail("Attachment is too long");
  }

  for (const f of fields) {
    if (!f.required) continue;
    const empty = f.type === "year_range" ? yearFrom === null : !values[f.id];
    const mapped = targets.some(
      (t) => t && "fieldId" in t && t.fieldId === f.id,
    );
    if (mapped && empty) return fail(`${f.label} is empty`);
  }

  return { values, yearFrom, yearTo, attachment, error: null, raw: null };
}
