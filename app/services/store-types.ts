// Store type presets offered at onboarding. Copied from .claude/design/scripts/data/store-types.js
// (labels, wording, default fields). The real app creates no sample rows (specs/onboarding.md).
import type { FieldType, StoreType } from "@prisma/client";

export const STORE_TYPE_KEYS = [
  "automotive",
  "phones",
  "beauty",
  "custom",
] as const satisfies readonly StoreType[];

export type StoreIcon = "car" | "phone" | "beauty" | "spark";

export interface StoreTypePreset {
  label: string;
  blurb: string;
  icon: StoreIcon;
  /** Pastel tile colour class, as in the prototype. */
  tile: "t-indigo" | "t-pink" | "t-teal" | "t-amber";
  /** Shopper noun: vehicle / phone / profile / item. */
  noun: string;
  /** Word for the products: parts / accessories / products. */
  things: string;
  heading: string;
  fields: ReadonlyArray<{ label: string; type: FieldType }>;
}

export const STORE_TYPES: Record<StoreType, StoreTypePreset> = {
  automotive: {
    label: "Automotive",
    blurb:
      "Car, motorcycle or truck parts. Shoppers search by make, year and model.",
    icon: "car",
    tile: "t-indigo",
    noun: "vehicle",
    things: "parts",
    heading: "Find parts for your vehicle",
    fields: [
      { label: "Make", type: "list" },
      { label: "Year", type: "year_range" },
      { label: "Model", type: "list" },
    ],
  },
  phones: {
    label: "Phones and accessories",
    blurb:
      "Brand, series and model. For cases, chargers and screen protectors.",
    icon: "phone",
    tile: "t-pink",
    noun: "phone",
    things: "accessories",
    heading: "Find accessories for your phone",
    fields: [
      { label: "Brand", type: "list" },
      { label: "Series", type: "list" },
      { label: "Model", type: "list" },
    ],
  },
  beauty: {
    label: "Beauty and personal care",
    blurb:
      "Skincare, haircare, makeup, fragrance and beauty devices. Shoppers filter by brand, product type and gender.",
    icon: "beauty",
    tile: "t-teal",
    noun: "profile",
    things: "products",
    heading: "Find the right beauty product for you",
    fields: [
      { label: "Brand", type: "list" },
      { label: "Product type", type: "list" },
      { label: "Gender", type: "list" },
    ],
  },
  custom: {
    label: "Something else",
    blurb:
      "Printers, appliances, bicycles, tools or anything with a model. You name the fields.",
    icon: "spark",
    tile: "t-amber",
    noun: "item",
    things: "products",
    heading: "Find products that fit",
    fields: [
      { label: "Brand", type: "list" },
      { label: "Model", type: "list" },
    ],
  },
};

/** Default placeholder, as the prototype shows it (placeholderFor in shared-ui.js). */
export function defaultPlaceholder(label: string): string {
  return `Select ${label.toLowerCase()}`;
}

/** Rows to create for a store type: the search config and its ordered fields. */
export function buildSetup(storeType: StoreType) {
  const preset = STORE_TYPES[storeType];
  return {
    config: {
      storeType,
      heading: preset.heading,
      noun: preset.noun,
      thingsWord: preset.things,
    },
    fields: preset.fields.map((f, position) => ({
      position,
      label: f.label,
      placeholder: defaultPlaceholder(f.label),
      type: f.type,
      required: true,
    })),
  };
}
