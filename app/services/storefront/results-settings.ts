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
/** Tags that can be shown as badges on product cards. */
export const MAX_BADGE_TAGS = 10;
/** Button texts (Add to cart, the no-results button). */
export const CART_TEXT_MAX = 40;
export const EMPTY_TEXT_MAX = 200;
/** Custom page width in px. */
export const PAGE_WIDTH_MIN = 600;
export const PAGE_WIDTH_MAX = 2400;
/** Longest badge label (the text shown instead of the tag). */
export const BADGE_LABEL_MAX = 40;
/** Badge font size in px. */
export const BADGE_SIZE_MIN = 8;
export const BADGE_SIZE_MAX = 24;
/** Largest space between product cards in px. */
export const CARD_GAP_MAX = 60;
/** A link the merchant types: a path on the store (/collections/all) or an http(s) address. */
// Not "//host" or "/\\host" (browsers read both as another site); no spaces, quotes or <>.
export const SAFE_LINK = /^(\/(?![/\\])|https?:\/\/)[^\s"'<>\\]*$/;
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

/** Corners of the Add to cart button and the badges. */
export type Shape = "square" | "rounded" | "pill";
export const SHAPE_RADIUS: Record<Shape, string> = {
  square: "0",
  rounded: "6px",
  pill: "999px",
};

/** A product tag shown as a badge on the cards, with its colours (#RRGGBB). */
export interface BadgeTag {
  tag: string;
  bg: string;
  color: string;
  /** Turned off badges stay in the list but don't show on the page. */
  active: boolean;
  /** Text shoppers see instead of the tag ("" = the tag). */
  label: string;
}
export const BADGE_TAG_COLORS = { bg: "#FFFFFF", color: "#1A1A1A" };

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
  /** Product cards: the "Fits" badge, the price and the SKU (added 2026-10-23). */
  cardFit: boolean;
  cardPrice: boolean;
  cardSku: boolean;
  /** Sale price (compare-at struck through), a "Sold out" label, the vendor and the image shape. */
  cardCompare: boolean;
  cardSoldOut: boolean;
  cardVendor: boolean;
  cardImage: "square" | "portrait" | "natural";
  /** Badges on the card image: "Sale" (compare-at > price) and product tags shown as badges. */
  badgeSale: boolean;
  badgeTags: BadgeTag[];
  /** Badge colours (#RRGGBB) and shape. */
  soldOutBg: string;
  soldOutColor: string;
  /** Built-in badge texts ("" = "Sold out" / "Sale"). */
  soldOutLabel: string;
  saleLabel: string;
  /** Card price colours (#RRGGBB): the price, and the struck-through compare-at price. */
  priceColor: string;
  comparePriceColor: string;
  saleBg: string;
  saleColor: string;
  badgeShape: Shape;
  /** All badges: font size in px (0 = automatic, a little smaller than the text) and weight. */
  badgeSize: number;
  badgeWeight: "400" | "500" | "600" | "700" | "800";
  /** An Add to cart button under each card (Choose options / Sold out when it can't add). */
  cardCart: boolean;
  /** Its text ("" = "Add to cart") and look. */
  cartText: string;
  cartStyle: "filled" | "outline";
  /** Add to cart button shape and colours ("" = the search widget's button colour / white). */
  cartShape: Shape;
  cartBg: string;
  cartColor: string;
  /** Card images: cropped to fill, or whole on white; the second image on hover. */
  imageFit: "cover" | "contain";
  imageHover: boolean;
  /** Product title: lines shown before "…", and the card's text alignment. */
  titleLines: "1" | "2" | "full";
  cardAlign: "left" | "center";
  /** The page as wide as the theme's pages, the full window (with side spacing) or at most
   *  pageMaxWidth px. */
  pageWidth: "theme" | "full" | "custom";
  pageMaxWidth: number;
  /** Space between product cards in px (rows and columns), on desktop and on mobile. */
  cardGap: number;
  cardGapMobile: number;
  /** No products for the selection (without filter picks): text ("" = the search widget's
   *  No results text) and an optional button. */
  emptyText: string;
  emptyButton: string;
  emptyUrl: string;
  /** Page numbers, or a Load more button that adds the next page under the products. */
  paging: "pages" | "more";
  /** Vertical layout on desktop: the sidebar stays in view while scrolling. */
  stickySide: boolean;
  titleAlign: "left" | "center" | "right";
  titleSize: number;
  /** Title size on mobile (under 750px) in px; 0 = the same as on desktop. */
  titleSizeMobile: number;
  /** Title font weight; "" = the theme's. */
  titleWeight: "" | "400" | "500" | "600" | "700" | "800";
  titleColor: string;
  columns: "2" | "3" | "4" | "5";
  mobileColumns: "1" | "2";
  /** Rows of products per page: a page always ends on a full row (see productsPerPage). */
  rowsPerPage: number;
  sort: ResultsSort;
}

const SORT_KEYS = [
  "match",
  "title-asc",
  "title-desc",
  "newest",
  "oldest",
] as const;
export type ResultsSort = (typeof SORT_KEYS)[number];

/** Sort options in the order shoppers see them (newest/oldest by Shopify's product id, which grows
 *  with creation). */
export const SORTS: [ResultsSort, string][] = [
  ["match", "Best fit"],
  ["title-asc", "Name, A–Z"],
  ["title-desc", "Name, Z–A"],
  ["newest", "Newest"],
  ["oldest", "Oldest"],
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
    cardFit: true,
    cardPrice: true,
    cardSku: false,
    cardCompare: true,
    cardSoldOut: true,
    cardVendor: false,
    cardImage: "square",
    badgeSale: false,
    badgeTags: [],
    soldOutBg: "#1A1A1A",
    soldOutColor: "#FFFFFF",
    soldOutLabel: "",
    saleLabel: "",
    priceColor: "#1A1A1A",
    comparePriceColor: "#1A1A1A",
    saleBg: "#B42318",
    saleColor: "#FFFFFF",
    badgeShape: "pill",
    badgeSize: 0,
    badgeWeight: "600",
    cardCart: false,
    cartText: "",
    cartStyle: "filled",
    cartShape: "pill",
    cartBg: "",
    cartColor: "",
    imageFit: "cover",
    imageHover: false,
    titleLines: "2",
    cardAlign: "left",
    pageWidth: "theme",
    pageMaxWidth: 1200,
    cardGap: 20,
    cardGapMobile: 12,
    emptyText: "",
    emptyButton: "",
    emptyUrl: "",
    paging: "pages",
    stickySide: true,
    titleAlign: "left",
    titleSize: 0,
    titleSizeMobile: 0,
    titleWeight: "",
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

const HEX = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const SHAPE = z.enum(["square", "rounded", "pill"]);

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
  cardFit: z.boolean(),
  cardPrice: z.boolean(),
  cardSku: z.boolean(),
  cardCompare: z.boolean(),
  cardSoldOut: z.boolean(),
  cardVendor: z.boolean(),
  cardImage: z.enum(["square", "portrait", "natural"]),
  badgeSale: z.boolean(),
  cardCart: z.boolean(),
  cartText: z.string().trim().max(CART_TEXT_MAX),
  cartStyle: z.enum(["filled", "outline"]),
  cartShape: SHAPE,
  cartBg: z.union([z.literal(""), HEX]),
  cartColor: z.union([z.literal(""), HEX]),
  soldOutBg: HEX,
  soldOutColor: HEX,
  saleBg: HEX,
  saleColor: HEX,
  soldOutLabel: z.string().trim().max(BADGE_LABEL_MAX),
  saleLabel: z.string().trim().max(BADGE_LABEL_MAX),
  priceColor: HEX,
  comparePriceColor: HEX,
  badgeShape: SHAPE,
  badgeSize: z.number().int().min(0).max(BADGE_SIZE_MAX),
  badgeWeight: z.enum(["400", "500", "600", "700", "800"]),
  imageFit: z.enum(["cover", "contain"]),
  imageHover: z.boolean(),
  titleLines: z.enum(["1", "2", "full"]),
  cardAlign: z.enum(["left", "center"]),
  pageWidth: z.enum(["theme", "full", "custom"]),
  pageMaxWidth: z.number().int().min(PAGE_WIDTH_MIN).max(PAGE_WIDTH_MAX),
  cardGap: z.number().int().min(0).max(CARD_GAP_MAX),
  cardGapMobile: z.number().int().min(0).max(CARD_GAP_MAX),
  emptyText: z.string().trim().max(EMPTY_TEXT_MAX),
  emptyButton: z.string().trim().max(CART_TEXT_MAX),
  emptyUrl: z.union([
    z.literal(""),
    z.string().trim().max(500).regex(SAFE_LINK),
  ]),
  paging: z.enum(["pages", "more"]),
  stickySide: z.boolean(),
  // Plain tags until 2026-10-23: they get the default colours.
  badgeTags: z
    .array(
      z.preprocess(
        (v) => (typeof v === "string" ? { tag: v, ...BADGE_TAG_COLORS } : v),
        z.object({
          tag: z.string().trim().min(1).max(TAG_MAX),
          bg: HEX,
          color: HEX,
          // Saved before badges could be turned off: on.
          active: z.boolean().default(true),
          label: z.string().trim().max(BADGE_LABEL_MAX).default(""),
        }),
      ),
    )
    .max(MAX_BADGE_TAGS)
    .refine(
      (t) => new Set(t.map((x) => x.tag.toLowerCase())).size === t.length,
    ),
  titleAlign: z.enum(["left", "center", "right"]),
  // Size words saved before px (2026-10-22) still read.
  titleSize: z.preprocess(
    (v) => ({ theme: 0, small: 24, medium: 32, large: 44 })[v as string] ?? v,
    z.number().int().min(0).max(TITLE_SIZE_MAX),
  ),
  titleSizeMobile: z.number().int().min(0).max(TITLE_SIZE_MAX),
  titleWeight: z.enum(["", "400", "500", "600", "700", "800"]),
  titleColor: z.union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/)]),
  columns: z.enum(["2", "3", "4", "5"]),
  mobileColumns: z.enum(["1", "2"]),
  rowsPerPage: z.number().int().min(1).max(MAX_PAGE_PRODUCTS),
  // SKU sorts were offered briefly (2026-10-23): a saved one falls back to Best fit.
  sort: z.preprocess(
    (v) => (v === "sku-asc" || v === "sku-desc" ? "match" : v),
    z.enum(SORT_KEYS),
  ),
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
  const whole = parseResultsPage({
    ...defaultResultsPage(),
    ...(doc as object),
  });
  if (whole) return whole;
  // One field no longer valid (e.g. a limit lowered later) keeps every other saved setting:
  // that field alone goes back to its default.
  const out = defaultResultsPage() as unknown as Record<string, unknown>;
  for (const [key, field] of Object.entries(resultsPageSchema.shape)) {
    const value = (doc as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const r = (field as z.ZodTypeAny).safeParse(value);
    if (r.success) out[key] = r.data;
  }
  return out as unknown as ResultsPageSettings;
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
