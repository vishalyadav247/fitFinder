// Pure rules for search fields (specs/search-setup.md). No database access; shared by server and UI.
import type { FieldType } from "@prisma/client";
import { defaultPlaceholder } from "./store-types";

export const NEW_FIELD_LABEL = "New field";
export const LABEL_MAX = 60;
export const PLACEHOLDER_MAX = 80;

/** Hint under Add field, per store type (prototype search-setup.js). */
export const ADD_FIELD_HINT: Record<string, string> = {
  automotive: "For example Engine, Trim or Body type",
  phones: "For example Storage size or Colour",
  beauty: "For example Concern, Skin type or Age group",
  custom: "For example Type, Series or Model number",
};

/** Shown placeholder: the saved one, or "Select {field name}". */
export function placeholderFor(f: { label: string; placeholder: string }) {
  return f.placeholder || defaultPlaceholder(f.label);
}

/** What to store for a typed placeholder: "" when it's empty or equals the default. */
export function placeholderToStore(label: string, typed: string): string {
  const t = typed.trim();
  return t === "" || t === defaultPlaceholder(label) ? "" : t;
}

/**
 * Keeps a saved import-mapping target sensible when a field's type changes (prototype app.js):
 * Dropdown → Year range: the one column becomes a one-column range.
 * Year range → Dropdown: a range or "from" column becomes the field's column; a "to" column is dropped.
 * Returns the new target, or null to drop the mapping entry.
 */
export function remapTarget(
  target: string,
  fieldId: string,
  newType: FieldType,
): string | null {
  const base = `field:${fieldId}`;
  if (newType === "year_range") {
    return target === base ? `${base}:range` : target;
  }
  if (target === `${base}:to`) return null;
  if (target === `${base}:from` || target === `${base}:range`) return base;
  return target;
}

/** True when a mapping target points at the field (any part of it). */
export function targetsField(target: string, fieldId: string): boolean {
  const base = `field:${fieldId}`;
  return target === base || target.startsWith(`${base}:`);
}

/** The value/checked properties Polaris form elements expose. */
export interface SyncableControl {
  value: string;
  checked: boolean;
}

/**
 * Writes saved values back onto form controls after a save, so they show what the server kept,
 * skipping the control that has focus (the merchant may be typing in it).
 */
export function syncControls(
  controls: Record<string, SyncableControl | null>,
  saved: Record<string, string | boolean>,
  active: unknown,
): void {
  for (const [name, value] of Object.entries(saved)) {
    const el = controls[name];
    if (!el || el === active) continue;
    if (typeof value === "boolean") {
      if (el.checked !== value) el.checked = value;
    } else if (el.value !== value) {
      el.value = value;
    }
  }
}
