// A shopper's picks in the search widget, as sent to the app proxy: one query parameter per
// search field id (`{fieldId}=value`, data-model.md › Storefront API). Pure.
import type { FieldType } from "@prisma/client";

export interface PickField {
  id: string;
  type: FieldType;
  required: boolean;
}

/** Field id → picked value (a year as a number for Year range fields). */
export type Picks = Map<string, string | number>;

export const MAX_PICK_LENGTH = 200;
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

/**
 * Reads the picks for `fields` from the query. Unknown parameters (Shopify's shop, signature …)
 * are ignored; an empty value means "not picked". Returns null when a value is invalid
 * (too long, or a year that isn't a whole number in range).
 */
export function parsePicks(
  params: URLSearchParams,
  fields: PickField[],
): Picks | null {
  const picks: Picks = new Map();
  for (const f of fields) {
    const raw = params.get(f.id);
    if (raw === null || raw === "") continue;
    if (raw.length > MAX_PICK_LENGTH) return null;
    if (f.type === "year_range") {
      if (!/^\d{4}$/.test(raw)) return null;
      const year = Number(raw);
      if (year < MIN_YEAR || year > MAX_YEAR) return null;
      picks.set(f.id, year);
    } else {
      picks.set(f.id, raw);
    }
  }
  return picks;
}

/** Only the picks of the fields before `index` (the cascade: a dropdown depends on those). */
export function picksBefore(
  picks: Picks,
  fields: PickField[],
  index: number,
): Picks {
  const out: Picks = new Map();
  for (const f of fields.slice(0, index)) {
    if (picks.has(f.id)) out.set(f.id, picks.get(f.id)!);
  }
  return out;
}

/** Every required field has a pick (the search button's rule). */
export function isComplete(picks: Picks, fields: PickField[]): boolean {
  return picks.size > 0 && fields.every((f) => !f.required || picks.has(f.id));
}

/** Stable text for cache keys. */
export function picksKey(picks: Picks): string {
  return JSON.stringify(
    [...picks.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

/** Dropdown order: years newest first, text A–Z (numbers in natural order). */
export function sortOptions(type: FieldType, values: string[]): string[] {
  return type === "year_range"
    ? [...values].sort((a, b) => Number(b) - Number(a))
    : [...values].sort(collator.compare);
}

/**
 * Short name of a selection, as My Selection and the fits badge show it: the year, the first
 * dropdown and the last dropdown, e.g. "2008 AUDI A6 C6 Avant (4F5)" (prototype storefront.js).
 * The same rule is in the theme extension's fitfinder.js (label()).
 */
export function selectionLabel(
  fields: { id: string; type: FieldType }[],
  picks: Picks,
): string {
  const year = fields.find((f) => f.type === "year_range");
  const lists = fields
    .filter((f) => f.type !== "year_range" && picks.has(f.id))
    .map((f) => String(picks.get(f.id)));
  const parts = [
    year && picks.has(year.id) ? String(picks.get(year.id)) : "",
    lists[0] ?? "",
    lists.length > 1 ? lists[lists.length - 1] : "",
  ];
  return parts.filter(Boolean).join(" ");
}

/** Query string of the picks (field order), for links back to the results. */
export function picksQuery(
  fields: { id: string }[],
  picks: Picks,
): URLSearchParams {
  const q = new URLSearchParams();
  for (const f of fields)
    if (picks.has(f.id)) q.set(f.id, String(picks.get(f.id)));
  return q;
}
