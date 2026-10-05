// Cleaning and year parsing for imported cells. Pure functions; no I/O.
// Real-world CSVs (exports, files that went through Excel) carry non-breaking spaces, their
// mojibake "Â " form, and years written as MM/YY, MM/YYYY, DD-MM-YYYY or plain YYYY.

/** Trims and normalises spaces: NBSP, "Â " (NBSP read as Latin-1) and runs of whitespace. */
export function cleanValue(value: unknown): string {
  return `${value ?? ""}`
    .replace(/Â\u00a0/g, " ")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Undoes the export's formula guard (csvCell): "'=SUM(A1)" → "=SUM(A1)". Only an apostrophe
 * before a formula character is removed, so a Filter data export imports back unchanged.
 */
export function unescapeCell(value: string): string {
  return /^'+[=+\-@]/.test(value) ? value.slice(1) : value;
}

// Two-digit years: up to (current year + HEADROOM) are 20xx, the rest 19xx.
// "08/24" → 2024, "11/98" → 1998, "01/28" → 2028 while it's within the headroom.
const PIVOT_HEADROOM = 5;
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

function pivot(yy: number, now: Date): number {
  return yy <= (now.getFullYear() % 100) + PIVOT_HEADROOM
    ? 2000 + yy
    : 1900 + yy;
}

export type YearCell =
  | { kind: "year"; year: number }
  | { kind: "open" } // "/" or empty: no bound
  | { kind: "invalid" };

/**
 * One year cell: "2016", "08/24" (MM/YY), "08/2024" (MM/YYYY), "15-08-2024" / "15.08.2024"
 * (DD-MM-YYYY), or "/" / "" for no bound.
 */
export function parseYearCell(value: unknown, now = new Date()): YearCell {
  const raw = cleanValue(value);
  if (raw === "" || raw === "/" || raw === "-") return { kind: "open" };

  let year: number | null = null;
  let m: RegExpMatchArray | null;
  if ((m = raw.match(/^([0-9]{4})$/))) year = Number(m[1]);
  else if ((m = raw.match(/^([0-9]{1,2})\/([0-9]{2})$/)))
    year = Number(m[1]) <= 12 ? pivot(Number(m[2]), now) : null;
  else if ((m = raw.match(/^([0-9]{1,2})\/([0-9]{4})$/)))
    year = Number(m[1]) <= 12 ? Number(m[2]) : null;
  else if ((m = raw.match(/^[0-9]{1,2}[-./][0-9]{1,2}[-./]([0-9]{4})$/)))
    year = Number(m[1]);

  if (year === null || year < MIN_YEAR || year > MAX_YEAR) {
    return { kind: "invalid" };
  }
  return { kind: "year", year };
}

export type YearRange =
  { ok: true; from: number | null; to: number | null } | { ok: false };

/** Combines a from cell and a to cell. A missing "to" means an open range ("still made"). */
export function yearsFromCells(
  fromCell: unknown,
  toCell: unknown,
  now = new Date(),
): YearRange {
  const from = parseYearCell(fromCell, now);
  const to = parseYearCell(toCell, now);
  if (from.kind === "invalid" || to.kind === "invalid") return { ok: false };
  const f = from.kind === "year" ? from.year : null;
  const t = to.kind === "year" ? to.year : null;
  if (f !== null && t !== null && f > t) return { ok: false };
  if (f === null && t !== null) return { ok: true, from: t, to: t };
  return { ok: true, from: f, to: t };
}

/**
 * One range cell: "2008-2011", "2008 – 2011", "2016-" (open), "2016" (one year),
 * "08/24 - /" (MM/YY parts). Empty → no years.
 */
export function parseYearRangeCell(
  value: unknown,
  now = new Date(),
): YearRange {
  const raw = cleanValue(value);
  if (raw === "") return { ok: true, from: null, to: null };

  const single = parseYearCell(raw, now);
  if (single.kind === "year") {
    return { ok: true, from: single.year, to: single.year };
  }

  // Split on a dash with spaces, or the last dash/en dash that isn't inside a DD-MM-YYYY date.
  const spaced = raw.split(/\s+[-–]\s*|\s*[-–]\s+/);
  const parts = spaced.length === 2 ? spaced : splitOnRangeDash(raw);
  if (!parts) return { ok: false };
  const [left, right] = parts;
  const r = yearsFromCells(left, right, now);
  if (!r.ok || r.from === null) return { ok: false };
  return r;
}

function splitOnRangeDash(raw: string): [string, string] | null {
  const m = raw.match(/^(.+?)[-–](.*)$/);
  return m ? [m[1], m[2]] : null;
}
