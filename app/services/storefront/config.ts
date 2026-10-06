// The document the theme app extension reads from the app metafield (fitfinder.config): search
// fields, wording and every storefront setting, so the blocks render without an extra request
// (specs/storefront.md › Data). Pure.
import type { FieldType, StoreType } from "@prisma/client";
import { placeholderFor } from "../search-fields";
import {
  resolveSettings,
  wordingFor,
  type StorefrontSettings,
} from "./settings";

/** App proxy path the storefront calls (shopify.app.toml [app_proxy] prefix + subpath). */
export const PROXY_PATH = "/apps/fitfinder";

export const CONFIG_NAMESPACE = "fitfinder";
export const CONFIG_KEY = "config";

export interface StorefrontField {
  id: string;
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
}

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
}

export function buildStorefrontConfig({
  config,
  fields,
  stored,
}: ConfigSource): StorefrontConfig {
  const ordered = [...fields].sort((a, b) => a.position - b.position);
  const s = resolveSettings(stored, wordingFor(config));
  // Hidden columns of fields that no longer exist are dropped; one column always stays.
  const hide: Record<string, boolean> = {};
  for (const f of ordered) if (s.tableHide[f.id]) hide[f.id] = true;
  if (ordered.length && ordered.every((f) => hide[f.id])) {
    delete hide[ordered[0].id];
  }
  // "Newest year first" needs a Year range field.
  const hasYears = ordered.some((f) => f.type === "year_range");
  return {
    v: 1,
    proxy: PROXY_PATH,
    heading: config.heading,
    noun: config.noun,
    things: config.thingsWord,
    fields: ordered.map((f) => ({
      id: f.id,
      label: f.label,
      placeholder: placeholderFor(f),
      type: f.type === "year_range" ? "years" : "list",
      required: f.required,
    })),
    s: {
      ...s,
      tableHide: hide,
      tableSort: hasYears ? s.tableSort : "fields",
    },
  };
}
