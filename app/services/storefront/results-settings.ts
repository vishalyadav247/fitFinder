// Results page settings (specs/storefront.md › Results page tab): the filters built from product
// tags and the grid layout of SpareFit's results page (/apps/sparefit/results). Stored in
// storefront_settings.settings under RESULTS_KEY, beside the storefront settings but not in the
// app metafield: only the app proxy reads them. Pure; shared by server and admin UI (preview).
import { z } from "zod";

export const RESULTS_KEY = "resultsPage";
export const MAX_FILTERS = 8;
/** Values listed per filter on the page; the rest are left out (most products first). */
export const MAX_FILTER_VALUES = 100;
/** "Show more" only when it would reveal at least this many more tags. */
export const MIN_MORE = 3;
export const FILTER_LABEL_MAX = 40;
/** Tags one filter group can offer. */
export const MAX_GROUP_TAGS = 50;
/** Shopify's longest product tag. */
export const TAG_MAX = 255;
export const PAGE_TITLE_MAX = 80;
/** Page title size in px (0 = the theme's own). */
export const TITLE_SIZE_MIN = 12;
export const TITLE_SIZE_MAX = 96;
/** Most products one page shows: Liquid's all_products reads 20 unique handles per page (agreed
 *  2026-10-22 to use all 20; storing image and price in the catalog would lift it). */
export const MAX_PAGE_PRODUCTS = 20;

/** Rows a page can have with this many products per row (at least 1). */
export const maxRows = (columns: number) =>
  Math.max(1, Math.floor(MAX_PAGE_PRODUCTS / columns));

/** Products per page: products per row × rows, the rows capped so a page fits MAX_PAGE_PRODUCTS. */
export const productsPerPage = (s: {
  columns: string;
  rowsPerPage: number;
}) => {
  const columns = Number(s.columns);
  return columns * Math.min(Math.max(1, s.rowsPerPage), maxRows(columns));
};

/**
 * A filter group (agreed 2026-10-22: the simple way): a name and the product tags it offers,
 * exactly as they are on the products. Picking a tag shows the products with that tag.
 */
export interface ResultsFilter {
  /** Short id, also the URL parameter: f_{id}=tag. */
  id: string;
  label: string;
  /** Product tags shown as this group's options, in this order. */
  tags: string[];
}

export interface ResultsPageSettings {
  filters: ResultsFilter[];
  filterTitle: string;
  showCounts: boolean;
  /** Sidebar next to the grid, dropdowns above it, or a panel that slides in. */
  filterLayout: "vertical" | "horizontal" | "drawer";
  /** Vertical layout: which side the sidebar is on. */
  filterSide: "left" | "right";
  /** Sidebar and drawer: filter groups start open (a group with picks is always open). */
  groupsOpen: "all" | "first" | "none";
  /** Sidebar and drawer: values listed before "Show more". */
  valuesShown: "5" | "10" | "all";
  showSort: boolean;
  /** "24 results" above the products. */
  showCount: boolean;
  /** The search widget at the top of the page (prefilled with the shopper's selection). */
  showWidget: boolean;
  /** The page heading; "" = "{Things} that fit your {noun}" from the store type's wording. */
  pageTitle: string;
  /** The page title: shown or not, alignment, size in px (0 = the theme's h1) and colour ("" = the theme's). */
  showTitle: boolean;
  titleAlign: "left" | "center" | "right";
  titleSize: number;
  titleColor: string;
  columns: "2" | "3" | "4" | "5";
  mobileColumns: "1" | "2";
  /** Rows of products per page: a page always ends on a full row (see productsPerPage). */
  rowsPerPage: number;
  sort: "match" | "title-asc" | "title-desc";
}

export const SORTS: [ResultsPageSettings["sort"], string][] = [
  ["match", "Best fit"],
  ["title-asc", "Name, A–Z"],
  ["title-desc", "Name, Z–A"],
];

export function defaultResultsPage(): ResultsPageSettings {
  return {
    filters: [],
    filterTitle: "Filters",
    showCounts: true,
    filterLayout: "vertical",
    filterSide: "left",
    groupsOpen: "first",
    valuesShown: "5",
    showSort: true,
    showCount: true,
    showWidget: true,
    pageTitle: "",
    showTitle: true,
    titleAlign: "left",
    titleSize: 0,
    titleColor: "",
    columns: "4",
    mobileColumns: "2",
    rowsPerPage: 4,
    sort: "match",
  };
}

const FILTER_ID = /^[a-z0-9]{1,12}$/;

const filterSchema = z.object({
  id: z.string().regex(FILTER_ID),
  label: z.string().trim().min(1).max(FILTER_LABEL_MAX),
  // A group saved before tags were picked (prefix rule) has none: it shows nothing until edited.
  tags: z
    .array(z.string().trim().min(1).max(TAG_MAX))
    .max(MAX_GROUP_TAGS)
    .default([])
    .refine((t) => new Set(t.map((x) => x.toLowerCase())).size === t.length),
  // Groups always show as a list with checkboxes (2026-10-22); an older "style" is dropped.
});

export const resultsPageSchema = z.object({
  filters: z
    .array(filterSchema)
    .max(MAX_FILTERS)
    .refine((f) => new Set(f.map((x) => x.id)).size === f.length),
  filterTitle: z.string().trim().min(1).max(FILTER_LABEL_MAX),
  showCounts: z.boolean(),
  filterLayout: z.enum(["vertical", "horizontal", "drawer"]),
  filterSide: z.enum(["left", "right"]),
  // Was a checkbox until 2026-10-22: on = all open, off = all closed.
  groupsOpen: z.preprocess(
    (v) => (v === true ? "all" : v === false ? "none" : v),
    z.enum(["all", "first", "none"]),
  ),
  valuesShown: z.enum(["5", "10", "all"]),
  showSort: z.boolean(),
  showCount: z.boolean(),
  showWidget: z.boolean(),
  pageTitle: z.string().trim().max(PAGE_TITLE_MAX),
  showTitle: z.boolean(),
  titleAlign: z.enum(["left", "center", "right"]),
  // Size words saved before px (2026-10-22) still read.
  titleSize: z.preprocess(
    (v) => ({ theme: 0, small: 24, medium: 32, large: 44 })[v as string] ?? v,
    z.number().int().min(0).max(TITLE_SIZE_MAX),
  ),
  titleColor: z.union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
  columns: z.enum(["2", "3", "4", "5"]),
  mobileColumns: z.enum(["1", "2"]),
  rowsPerPage: z.number().int().min(1).max(MAX_PAGE_PRODUCTS),
  sort: z.enum(["match", "title-asc", "title-desc"]),
});

/** A results page document from the browser: the whole thing, or null when it isn't valid. */
export function parseResultsPage(value: unknown): ResultsPageSettings | null {
  const r = resultsPageSchema.safeParse(value);
  return r.success ? r.data : null;
}

/** The stored settings document → results page settings over the defaults (invalid: defaults). */
export function storedResultsPage(stored: unknown): ResultsPageSettings {
  const doc =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)[RESULTS_KEY]
      : undefined;
  if (!doc || typeof doc !== "object") return defaultResultsPage();
  return (
    parseResultsPage({ ...defaultResultsPage(), ...(doc as object) }) ??
    defaultResultsPage()
  );
}

/** A new filter id that isn't in use yet. */
export function newFilterId(taken: string[]): string {
  for (;;) {
    const id = Math.random().toString(36).slice(2, 8);
    if (FILTER_ID.test(id) && !taken.includes(id)) return id;
  }
}

/** Picked filter values: filter id → values in lower case. */
export type FilterPicks = Record<string, string[]>;

export interface FacetValue {
  value: string;
  /** Products with this value among those matching the other filters' picks. */
  count: number;
  on: boolean;
}

export interface Facet {
  filter: ResultsFilter;
  values: FacetValue[];
}

/** Whether a product has a tag (tags compare without case, as Shopify treats them). */
const hasTag = (p: { tags: string[] }, lowerTags: string[]) =>
  p.tags.some((t) => lowerTags.includes(t.toLowerCase()));

/**
 * Each group's tags and how many products have them (the admin preview; the page uses SQL with
 * the same rules). Within a group, picks are OR; across groups, AND. A group's counts ignore its
 * own picks, so shoppers can add tags to it. Tags no product has are left out unless picked.
 */
export function facetsFor(
  products: { tags: string[] }[],
  filters: ResultsFilter[],
  picks: FilterPicks,
): Facet[] {
  const matches = (p: { tags: string[] }, f: ResultsFilter) => {
    const want = picks[f.id];
    return !want?.length || hasTag(p, want);
  };
  return filters.map((f) => {
    const rest = products.filter((p) =>
      filters.every((o) => o.id === f.id || matches(p, o)),
    );
    const on = new Set(picks[f.id] ?? []);
    return {
      filter: f,
      values: f.tags
        .map((tag) => ({
          value: tag,
          count: rest.filter((p) => hasTag(p, [tag.toLowerCase()])).length,
          on: on.has(tag.toLowerCase()),
        }))
        .filter((v) => v.count > 0 || v.on),
    };
  });
}

const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});
export const byValue = (a: { value: string }, b: { value: string }) =>
  collator.compare(a.value, b.value);

/** Picked tags from the page URL: f_{id}=tag (repeatable), lower case, only the group's own tags. */
export function filterPicksFrom(
  params: URLSearchParams,
  filters: ResultsFilter[],
): FilterPicks {
  const out: FilterPicks = {};
  for (const f of filters) {
    const values = [
      ...new Set(
        params
          .getAll(`f_${f.id}`)
          .map((v) => v.trim().toLowerCase())
          .filter((v) => f.tags.some((t) => t.toLowerCase() === v)),
      ),
    ].slice(0, MAX_GROUP_TAGS);
    if (values.length) out[f.id] = values;
  }
  return out;
}
