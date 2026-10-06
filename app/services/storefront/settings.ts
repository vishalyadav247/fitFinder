// Storefront settings (specs/storefront.md): every option of the Storefront page, with the
// prototype's defaults (.claude/design/scripts/screens/storefront.js › sf()). Keys keep the
// prototype names. Stored per shop in storefront_settings.settings (M8 edits them) and published
// to the theme in the app metafield (sync.server.ts). Pure; shared by server and admin UI.
import type { StoreType } from "@prisma/client";
import { STORE_TYPES } from "../store-types";

export type SavedIcon =
  | "star"
  | "heart"
  | "bookmark"
  | "clock"
  | "car"
  | "phone"
  | "beauty"
  | "spark"
  | "custom"
  | "none";

export interface StorefrontSettings {
  // Search widget
  layout: "bar" | "card";
  corners: "square" | "rounded" | "pill";
  btn: string;
  bg: string;
  text: string;
  labels: boolean;
  showHeading: boolean;
  button: string;
  saveLink: boolean;
  saveText: string;
  reset: boolean;
  resetText: string;
  noResults: string;
  // Fits badge
  askText: string;
  fitsText: string;
  noFitText: string;
  noFitLink: boolean;
  noFitLinkText: string;
  badgeSel: boolean;
  // Fitment table
  tablePlace: "block" | "tabs";
  tableStyle: "collapsible" | "open";
  tableTitle: string;
  tableOpen: boolean;
  tableLook: "lines" | "striped" | "plain";
  /** Search field ids whose column is hidden. */
  tableHide: Record<string, boolean>;
  tableSort: "fields" | "year";
  tableRows: "5" | "10" | "all";
  tableEmpty: "hide" | "text";
  tableEmptyText: string;
  showAllText: string;
  // My Selection (part of the app embed)
  garage: boolean;
  garageName: string;
  savedPos: "right-middle" | "left-middle" | "bottom-right" | "bottom-left";
  savedIcon: SavedIcon;
  savedIconUrl: string;
  savedBg: string;
  savedText: string;
  savedCount: boolean;
  maxSaved: "3" | "5" | "10";
  askSave: boolean;
  msSelected: string;
  msAdd: string;
  hintTitle: string;
  hintSub: string;
  hintEmpty: string;
  hintEmptySub: string;
}

/** Wording a store type gives the defaults: noun (vehicle …) and products word (parts …). */
export interface Wording {
  storeType: StoreType;
  noun: string;
  things: string;
}

export function defaultSettings({
  storeType,
  noun,
  things,
}: Wording): StorefrontSettings {
  return {
    layout: "bar",
    corners: "rounded",
    btn: "#1D4ED8",
    bg: "#FFFFFF",
    text: "#1A1A1A",
    labels: false,
    showHeading: true,
    button: `Show ${things}`,
    saveLink: true,
    saveText: "Save to My Selection",
    reset: true,
    resetText: "Reset",
    noResults: `No ${things} fit this selection yet.`,
    askText: `Select your ${noun} to check if it fits`,
    fitsText: `Fits your ${noun}`,
    noFitText: `Doesn't fit your ${noun}`,
    noFitLink: true,
    noFitLinkText: `See ${things} that fit`,
    badgeSel: true,
    tablePlace: "block",
    tableStyle: "collapsible",
    tableTitle: `Fits these ${noun}s`,
    tableOpen: true,
    tableLook: "lines",
    tableHide: {},
    tableSort: "fields",
    tableRows: "5",
    tableEmpty: "hide",
    tableEmptyText: `Fits all ${noun}s`,
    showAllText: "Show all {n}",
    garage: true,
    garageName: "My Selection",
    savedPos: "right-middle",
    savedIcon: STORE_TYPES[storeType].icon,
    savedIconUrl: "",
    savedBg: "#FFFFFF",
    savedText: "#1A1A1A",
    savedCount: true,
    maxSaved: "5",
    askSave: true,
    msSelected: "Selected",
    msAdd: `Add a ${noun}`,
    hintTitle: "Shopping for",
    hintSub: "{n} saved · Click to switch or add",
    hintEmpty: `Save your ${noun} here`,
    hintEmptySub: `Click to add your first ${noun}`,
  };
}

const COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Stored settings over the defaults. Unknown keys and values of the wrong kind are dropped
 * (a stored value must have the default's type; colours must be #RRGGBB; choices must be one of
 * the allowed values), so the theme always gets a complete, valid document.
 */
export function resolveSettings(
  stored: unknown,
  wording: Wording,
): StorefrontSettings {
  const out = defaultSettings(wording);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return out;
  }
  const s = stored as Record<string, unknown>;
  const target = out as unknown as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    const value = s[key];
    const def = target[key];
    if (value === undefined || typeof value !== typeof def) continue;
    if (key in CHOICES && !CHOICES[key].includes(value as string)) continue;
    if (COLOR_KEYS.has(key) && !COLOR.test(value as string)) continue;
    if (key === "tableHide") {
      if (!value || Array.isArray(value)) continue;
      target[key] = Object.fromEntries(
        Object.entries(value as object).filter(([, v]) => v === true),
      );
      continue;
    }
    if (key === "savedIconUrl" && value && !isHttpsUrl(value as string)) {
      continue;
    }
    target[key] = typeof value === "string" ? value.slice(0, 200) : value;
  }
  return out;
}

const CHOICES: Record<string, string[]> = {
  layout: ["bar", "card"],
  corners: ["square", "rounded", "pill"],
  tablePlace: ["block", "tabs"],
  tableStyle: ["collapsible", "open"],
  tableLook: ["lines", "striped", "plain"],
  tableSort: ["fields", "year"],
  tableRows: ["5", "10", "all"],
  tableEmpty: ["hide", "text"],
  savedPos: ["right-middle", "left-middle", "bottom-right", "bottom-left"],
  savedIcon: [
    "star",
    "heart",
    "bookmark",
    "clock",
    "car",
    "phone",
    "beauty",
    "spark",
    "custom",
    "none",
  ],
  maxSaved: ["3", "5", "10"],
};

const COLOR_KEYS = new Set(["btn", "bg", "text", "savedBg", "savedText"]);

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** The wording of a shop's search config (noun and products word can differ from the preset). */
export function wordingFor(config: {
  storeType: StoreType;
  noun: string;
  thingsWord: string;
}): Wording {
  return {
    storeType: config.storeType,
    noun: config.noun,
    things: config.thingsWord,
  };
}
