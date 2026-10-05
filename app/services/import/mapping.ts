// Column mapping for an import (specs/search-setup.md › Import › Map columns). Pure, rule-based.
// In the UI each column is mapped to a field id, "attachment" or "skip". A Year range field takes
// one column (a range like 2015-2020) or two (left = from, right = to); it's resolved to the
// stored targets field:{id}:range | :from | :to, which is also how import_mappings saves it.
import type { FieldType } from "@prisma/client";

export const ATTACHMENT = "attachment";
export const SKIP = "skip";

export interface MapField {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
}

/** UI choice per column index: field id | "attachment" | "skip". */
export type ColumnChoices = string[];

export type ResolvedTarget =
  | { kind: "attachment" }
  | { kind: "list"; fieldId: string }
  | { kind: "range"; fieldId: string }
  | { kind: "from"; fieldId: string }
  | { kind: "to"; fieldId: string };

/** Lower-case, no BOM, punctuation and repeated spaces folded: "Part_No." → "part no". */
export function normalizeHeader(h: string): string {
  return h
    .replace(/^\ufeff/, "")
    .toLowerCase()
    .replace(/[_\-./()[\]:#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Header names that mean the Attachment column (what a row links to). Generic, English.
const ATTACHMENT_HEADERS = new Set([
  "attachment",
  "sku",
  "skus",
  "variant sku",
  "product sku",
  "part",
  "part no",
  "part number",
  "partno",
  "article",
  "article no",
  "article number",
  "item number",
  "product",
  "product handle",
  "handle",
  "product url",
  "url",
  "link",
  "collection",
  "collection handle",
  "collection url",
]);
const FROM_WORDS = ["from", "start", "begin", "min"];
const TO_WORDS = ["to", "end", "until", "max"];

/** Max columns a choice can take: 2 for a Year range field, 1 otherwise. */
function capacity(choice: string, fields: MapField[]): number {
  const f = fields.find((x) => x.id === choice);
  return f?.type === "year_range" ? 2 : 1;
}

/**
 * Applies a pick on one column. When a choice is used on one column too many, the oldest other
 * column with that choice goes back to "skip" (spec). `order` lists column indexes, oldest pick first.
 */
export function pickColumn(
  choices: ColumnChoices,
  order: number[],
  column: number,
  choice: string,
  fields: MapField[],
): { choices: ColumnChoices; order: number[] } {
  const next = [...choices];
  next[column] = choice;
  let nextOrder = [...order.filter((c) => c !== column), column];
  if (choice !== SKIP) {
    const holders = nextOrder.filter((c) => next[c] === choice);
    const extra = holders.length - capacity(choice, fields);
    for (const c of holders.slice(0, Math.max(0, extra))) {
      next[c] = SKIP;
      nextOrder = nextOrder.filter((x) => x !== c);
    }
  } else {
    nextOrder = nextOrder.filter((c) => c !== column);
  }
  return { choices: next, order: nextOrder };
}

/** Resolves UI choices to stored targets per column (year field: 1 col = range, 2 = from/to by position). */
export function resolveChoices(
  choices: ColumnChoices,
  fields: MapField[],
): (ResolvedTarget | null)[] {
  return choices.map((choice, col) => {
    if (choice === ATTACHMENT) return { kind: "attachment" };
    const f = fields.find((x) => x.id === choice);
    if (!f) return null;
    if (f.type !== "year_range") return { kind: "list", fieldId: f.id };
    const cols = choices
      .map((c, i) => (c === choice ? i : -1))
      .filter((i) => i >= 0);
    if (cols.length === 1) return { kind: "range", fieldId: f.id };
    return { kind: col === cols[0] ? "from" : "to", fieldId: f.id };
  });
}

export function targetToString(t: ResolvedTarget): string {
  if (t.kind === "attachment") return ATTACHMENT;
  if (t.kind === "list") return `field:${t.fieldId}`;
  return `field:${t.fieldId}:${t.kind}`;
}

/** Saved target string → UI choice (field id or attachment), or null if it no longer applies. */
export function targetToChoice(
  target: string,
  fields: MapField[],
): string | null {
  if (target === ATTACHMENT) return ATTACHMENT;
  const m = target.match(/^field:([^:]+)(?::(range|from|to))?$/);
  if (!m) return null;
  return fields.some((f) => f.id === m[1]) ? m[1] : null;
}

/**
 * Pre-fills the mapping: the last import's mapping by column name first, then header-name
 * rules (a header equal to a field name; "{field} from/to" for a Year range; attachment words).
 */
export function guessChoices(
  headers: string[],
  fields: MapField[],
  saved: { columnName: string; target: string }[],
): ColumnChoices {
  const savedByName = new Map(
    saved.map((s) => [normalizeHeader(s.columnName), s.target]),
  );
  let choices: ColumnChoices = headers.map(() => SKIP);
  let order: number[] = [];
  const pick = (col: number, choice: string) => {
    ({ choices, order } = pickColumn(choices, order, col, choice, fields));
  };

  headers.forEach((h, col) => {
    const target = savedByName.get(normalizeHeader(h));
    const choice = target ? targetToChoice(target, fields) : null;
    if (choice) pick(col, choice);
  });

  const taken = (choice: string) =>
    choices.filter((c) => c === choice).length >= capacity(choice, fields);

  headers.forEach((h, col) => {
    if (choices[col] !== SKIP) return;
    const name = normalizeHeader(h);
    if (!taken(ATTACHMENT) && ATTACHMENT_HEADERS.has(name)) {
      return pick(col, ATTACHMENT);
    }
    for (const f of fields) {
      if (taken(f.id)) continue;
      const label = normalizeHeader(f.label);
      const words = name.split(" ");
      const isYearPart =
        f.type === "year_range" &&
        name.startsWith(label) &&
        words.some((w) => FROM_WORDS.includes(w) || TO_WORDS.includes(w));
      if (name === label || isYearPart) return pick(col, f.id);
    }
  });
  return choices;
}

/** Problems that stop step 2 (Next). The Attachment one shows the critical banner. */
export function validateChoices(choices: ColumnChoices): {
  attachmentMissing: boolean;
} {
  return { attachmentMissing: !choices.includes(ATTACHMENT) };
}
