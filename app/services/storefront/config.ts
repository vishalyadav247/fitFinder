// The document the theme app extension reads from the app metafield (sparefit.config): search
// fields, wording and every storefront setting, so the blocks render without an extra request
// (specs/storefront.md › Data). Pure.
import type { FieldType, StoreType } from "@prisma/client";
import { placeholderFor } from "../search-fields";
import { scopeCss } from "./custom-css";
import { urlNames } from "./picks";
import {
  resolveSettings,
  wordingFor,
  type StorefrontSettings,
} from "./settings";

/** App proxy path the storefront calls (shopify.app.toml [app_proxy] prefix + subpath). */
export const PROXY_PATH = "/apps/sparefit";

export const CONFIG_NAMESPACE = "sparefit";
export const CONFIG_KEY = "config";

export interface StorefrontField {
  id: string;
  /** Readable URL name for results links (?make=…); absent: links use the id. */
  n?: string;
  label: string;
  placeholder: string;
  type: "list" | "years";
  required: boolean;
}

export interface StorefrontConfig {
  v: 1;
  proxy: string;
  heading: string;
  noun: string;
  things: string;
  fields: StorefrontField[];
  s: StorefrontSettings;
  /** Blocks the store's plan doesn't include: they render nothing (plan-features.ts). */
  off: { badge: boolean; table: boolean };
  /** The merchant's custom CSS, scoped to SpareFit's elements (custom-css.ts); absent: none. */
  css?: string;
}

/** Where the merchant's raw custom CSS is kept: storefront_settings.settings, beside the settings. */
export const CUSTOM_CSS_KEY = "customCss";

/** The raw custom CSS in a stored settings document ("" when there is none). */
export function storedCustomCss(stored: unknown): string {
  const v =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)[CUSTOM_CSS_KEY]
      : undefined;
  return typeof v === "string" ? v : "";
}

/**
 * The first dropdown's values, in their own app metafield (sparefit.first) that only the search
 * block prints, so the widget fills it from the page without asking the app proxy and other
 * pages don't carry the list. `f` is the field the list belongs to: the widget uses it only
 * while that is still the config's first field. `v` null: no list (too large, couldn't be read);
 * the widget asks the proxy as for the other dropdowns.
 */
export const FIRST_KEY = "first";
export interface FirstList {
  f: string | null;
  v: string[] | null;
}

/** Field order everywhere (config, first list, proxy): position, then id for ties. */
export const byPosition = (
  a: { position: number; id: string },
  b: { position: number; id: string },
) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export interface ConfigSource {
  config: {
    storeType: StoreType;
    heading: string;
    noun: string;
    thingsWord: string;
  };
  fields: {
    id: string;
    label: string;
    placeholder: string;
    type: FieldType;
    required: boolean;
    position: number;
  }[];
  stored: unknown;
  /** The plan's storefront features; missing = all included (previews, tests). */
  features?: {
    fitsBadge: boolean;
    fitmentTable: boolean;
    mySelection: boolean;
    customCss?: boolean;
  };
}

export function buildStorefrontConfig({
  config,
  fields,
  stored,
  features = {
    fitsBadge: true,
    fitmentTable: true,
    mySelection: true,
    customCss: true,
  },
}: ConfigSource): StorefrontConfig {
  const ordered = [...fields].sort(byPosition);
  const s = resolveSettings(stored, wordingFor(config));
  // Hidden columns of fields that no longer exist are dropped; one column always stays.
  const hide: Record<string, boolean> = {};
  for (const f of ordered) if (s.tableHide[f.id]) hide[f.id] = true;
  if (ordered.length && ordered.every((f) => hide[f.id])) {
    delete hide[ordered[0].id];
  }
  // "Newest year first" needs a Year range field.
  const hasYears = ordered.some((f) => f.type === "year_range");
  const names = urlNames(ordered);
  // Custom CSS only when the plan includes it; absent when empty, so the config is unchanged.
  const css = features.customCss ? scopeCss(storedCustomCss(stored)).css : "";
  return {
    v: 1,
    proxy: PROXY_PATH,
    heading: config.heading,
    noun: config.noun,
    things: config.thingsWord,
    fields: ordered.map((f) => ({
      id: f.id,
      ...(names.has(f.id) ? { n: names.get(f.id) } : {}),
      label: f.label,
      placeholder: placeholderFor(f),
      type: f.type === "year_range" ? "years" : "list",
      required: f.required,
    })),
    off: { badge: !features.fitsBadge, table: !features.fitmentTable },
    s: {
      ...s,
      // My Selection is off when the plan doesn't include it.
      garage: s.garage && features.mySelection,
      tableHide: hide,
      tableSort: hasYears ? s.tableSort : "fields",
    },
    ...(css ? { css } : {}),
  };
}
