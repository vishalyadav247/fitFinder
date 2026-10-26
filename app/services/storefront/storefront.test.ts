// Storefront settings, config, picks and the results page (pure; M7).
import { describe, expect, it } from "vitest";
import {
  MAX_QUERY_LENGTH,
  NO_MATCH_QUERY,
  SKU_FIELD,
  searchPlan,
} from "./search-query";
import { defaultSettings, resolveSettings } from "./settings";
import {
  defaultResultsPage,
  parseResultsPage,
  maxRows,
  productsPerPage,
  RESULTS_KEY,
  SAFE_LINK,
  storedResultsPage,
} from "./results-settings";
import { buildStorefrontConfig, byPosition, PROXY_PATH } from "./config";
import {
  isComplete,
  parsePicks,
  picksBefore,
  picksKey,
  picksLinkQuery,
  picksQuery,
  selectionLabel,
  sortOptions,
  urlName,
  type PickField,
} from "./picks";
import {
  escapeLiquidText,
  resultsLiquid,
  type ResultsView,
} from "./results-page";

const auto = {
  storeType: "automotive" as const,
  noun: "vehicle",
  things: "parts",
};

describe("storefront settings", () => {
  it("uses the store type's noun and products word (prototype sf())", () => {
    const s = defaultSettings(auto);
    expect(s.button).toBe("Show parts");
    expect(s.askText).toBe("Select your vehicle to check if it fits");
    expect(s.noFitLinkText).toBe("See parts that fit");
    expect(s.tableTitle).toBe("Fits these vehicles");
    // My Selection's own texts are generic for every store type.
    expect(s.msAdd).toBe("Add a new selection");
    expect(s.msEmpty).toBe("Nothing saved yet");
    expect(s.hintEmpty).toBe("Save your selection here");
    expect(s.savedIcon).toBe("car");
    expect(s.garageName).toBe("My Selection");
    const phones = defaultSettings({
      storeType: "phones",
      noun: "phone",
      things: "accessories",
    });
    expect(phones.button).toBe("Show accessories");
    expect(phones.noResults).toBe("No accessories fit this selection yet.");
    expect(phones.savedIcon).toBe("phone");
  });

  it("keeps valid stored values and drops the rest", () => {
    const s = resolveSettings(
      {
        btn: "#112233",
        bg: "red", // not #RRGGBB
        layout: "card",
        corners: "round", // not a choice
        labels: "yes", // wrong type
        button: "Find",
        unknown: 1,
        tableHide: { a: true, b: false, c: "x" },
        savedIcon: "custom",
        savedIconUrl: "javascript:alert(1)",
      },
      auto,
    );
    expect(s.btn).toBe("#112233");
    expect(s.bg).toBe("#FFFFFF");
    expect(s.layout).toBe("card");
    expect(s.corners).toBe("rounded");
    expect(s.labels).toBe(false);
    expect(s.button).toBe("Find");
    expect("unknown" in s).toBe(false);
    expect(s.tableHide).toEqual({ a: true });
    expect(s.savedIcon).toBe("custom");
    expect(s.savedIconUrl).toBe("");
    expect(
      resolveSettings({ savedIconUrl: "https://cdn.shopify.com/i.png" }, auto)
        .savedIconUrl,
    ).toBe("https://cdn.shopify.com/i.png");
    expect(resolveSettings(null, auto)).toEqual(defaultSettings(auto));
    expect(resolveSettings([1], auto)).toEqual(defaultSettings(auto));
  });
});

const fieldRows = [
  {
    id: "model",
    label: "Model",
    placeholder: "",
    type: "list" as const,
    required: true,
    position: 2,
  },
  {
    id: "make",
    label: "Make",
    placeholder: "Pick a make",
    type: "list" as const,
    required: true,
    position: 0,
  },
  {
    id: "year",
    label: "Year",
    placeholder: "",
    type: "year_range" as const,
    required: true,
    position: 1,
  },
];
const searchConfig = {
  storeType: "automotive" as const,
  heading: "Find parts for your vehicle",
  noun: "vehicle",
  thingsWord: "parts",
};

describe("search widget looks", () => {
  it("defaults the dropdowns and the button, and keeps only valid choices", () => {
    const wording = {
      storeType: "automotive" as const,
      noun: "vehicle",
      things: "parts",
    };
    const d = defaultSettings(wording);
    expect([d.ddBg, d.ddText, d.ddCorners, d.btnText, d.btnCorners]).toEqual([
      "#FFFFFF",
      "#1A1A1A",
      "",
      "#FFFFFF",
      "",
    ]);
    const s = resolveSettings(
      {
        ddBg: "#123abc",
        ddCorners: "pill",
        btnCorners: "huge",
        btnText: "red",
      },
      wording,
    );
    // Heading, label and save link colours: unset by default (the widget's text colour).
    expect([d.headColor, d.labelColor, d.saveColor]).toEqual(["", "", ""]);
    expect(resolveSettings({ saveColor: "#00AA00" }, wording).saveColor).toBe(
      "#00AA00",
    );
    expect([s.ddBg, s.ddCorners, s.btnCorners, s.btnText]).toEqual([
      "#123abc",
      "pill",
      "",
      "#FFFFFF",
    ]);
  });
});

describe("storefront config (app metafield)", () => {
  it("orders fields, fills default placeholders and maps types", () => {
    const c = buildStorefrontConfig({
      config: searchConfig,
      fields: fieldRows,
      stored: {},
    });
    expect(c.v).toBe(1);
    expect(c.proxy).toBe(PROXY_PATH);
    expect(c.heading).toBe("Find parts for your vehicle");
    expect(c.fields.map((f) => f.id)).toEqual(["make", "year", "model"]);
    expect(c.fields[0].placeholder).toBe("Pick a make");
    expect(c.fields[2].placeholder).toBe("Select model");
    expect(c.fields[1].type).toBe("years");
    expect(c.fields[0].type).toBe("list");
  });

  it("gives fields readable URL names and keeps the results setting valid", () => {
    const c = buildStorefrontConfig({
      config: searchConfig,
      fields: fieldRows.map((f) => ({ ...f, id: "cmv-" + f.id })),
      stored: { results: "app" },
    });
    expect(c.fields.map((f) => f.n)).toEqual(["make", "year", "model"]);
    expect(c.s.results).toBe("app");
    const d = buildStorefrontConfig({
      config: searchConfig,
      fields: fieldRows,
      stored: { results: "elsewhere" },
    });
    expect(d.s.results).toBe("theme"); // default; unknown values ignored
    expect(d.fields[0].n).toBeUndefined(); // the name equals an id: id only
  });

  it("turns off the blocks the plan doesn't include", () => {
    const all = buildStorefrontConfig({
      config: searchConfig,
      fields: fieldRows,
      stored: {},
    });
    expect(all.off).toEqual({ badge: false, table: false });
    expect(all.s.garage).toBe(true);
    const c = buildStorefrontConfig({
      config: searchConfig,
      fields: fieldRows,
      stored: {},
      features: { fitsBadge: true, fitmentTable: false, mySelection: false },
    });
    expect(c.off).toEqual({ badge: false, table: true });
    expect(c.s.garage).toBe(false);
  });

  it("publishes the custom CSS scoped to SpareFit, only when the plan includes it", () => {
    const stored = { customCss: ".sp-sfw__go { color: red } @import url(x);" };
    const c = buildStorefrontConfig({
      config: searchConfig,
      fields: fieldRows,
      stored,
    });
    expect(c.css).toContain(":is(.sp-search-wrap,");
    expect(c.css).toContain("{color: red}");
    expect(c.css).not.toContain("@import");
    expect(c.s).not.toHaveProperty("customCss");
    const locked = buildStorefrontConfig({
      config: searchConfig,
      fields: fieldRows,
      stored,
      features: {
        fitsBadge: true,
        fitmentTable: true,
        mySelection: true,
        customCss: false,
      },
    });
    expect(locked).not.toHaveProperty("css");
    // No CSS: the key is absent, so existing configs (and their hash) don't change.
    expect(
      buildStorefrontConfig({
        config: searchConfig,
        fields: fieldRows,
        stored: {},
      }),
    ).not.toHaveProperty("css");
  });

  it("drops hidden columns of gone fields and always keeps one column", () => {
    const c = buildStorefrontConfig({
      config: searchConfig,
      fields: fieldRows,
      stored: {
        tableHide: { make: true, year: true, model: true, gone: true },
      },
    });
    expect(c.s.tableHide).toEqual({ year: true, model: true });
  });

  it("sorts by field order when there is no Year range field", () => {
    const lists = fieldRows.filter((f) => f.type === "list");
    const c = buildStorefrontConfig({
      config: searchConfig,
      fields: lists,
      stored: { tableSort: "year" },
    });
    expect(c.s.tableSort).toBe("fields");
    const withYears = buildStorefrontConfig({
      config: searchConfig,
      fields: fieldRows,
      stored: { tableSort: "year" },
    });
    expect(withYears.s.tableSort).toBe("year");
  });

  it("orders fields by position, then id for ties (same rule as the first dropdown list)", () => {
    const tied = [
      { ...fieldRows[0], id: "b", position: 0 },
      { ...fieldRows[1], id: "a", position: 0 },
      { ...fieldRows[2], id: "c", position: -1 },
    ];
    const c = buildStorefrontConfig({
      config: searchConfig,
      fields: tied,
      stored: {},
    });
    expect(c.fields.map((f) => f.id)).toEqual(["c", "a", "b"]);
    expect([...tied].sort(byPosition).map((f) => f.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});

const fields: (PickField & { label: string })[] = [
  { id: "make", label: "Make", type: "list", required: true },
  { id: "year", label: "Year", type: "year_range", required: true },
  { id: "model", label: "Model", type: "list", required: true },
  { id: "engine", label: "Engine", type: "list", required: false },
];

describe("picks", () => {
  it("reads field ids only, skips empty values and parses years", () => {
    const p = parsePicks(
      new URLSearchParams(
        "make=AUDI&year=2008&model=&shop=x.myshopify.com&signature=abc",
      ),
      fields,
    )!;
    expect([...p.entries()]).toEqual([
      ["make", "AUDI"],
      ["year", 2008],
    ]);
  });

  it("refuses bad years and long values", () => {
    for (const q of [
      "year=08",
      "year=2008.5",
      "year=1800",
      "year=2101",
      `make=${"x".repeat(201)}`,
    ]) {
      expect(parsePicks(new URLSearchParams(q), fields)).toBeNull();
    }
  });

  it("cascades, completes on required fields and keys stably", () => {
    const p = parsePicks(
      new URLSearchParams("model=A6&make=AUDI&year=2008"),
      fields,
    )!;
    expect([...picksBefore(p, fields, 2).keys()]).toEqual(["make", "year"]);
    expect(isComplete(p, fields)).toBe(true); // engine is optional
    expect(isComplete(picksBefore(p, fields, 2), fields)).toBe(false);
    expect(isComplete(new Map(), [])).toBe(false);
    const q = parsePicks(
      new URLSearchParams("year=2008&make=AUDI&model=A6"),
      fields,
    )!;
    expect(picksKey(p)).toBe(picksKey(q));
    expect(picksQuery(fields, p).toString()).toBe(
      "make=AUDI&year=2008&model=A6",
    );
  });

  it("reads readable field names too, and writes them for links", () => {
    const real: PickField[] = [
      { id: "cmv1", label: "Make", type: "list", required: true },
      { id: "cmv2", label: "Model year", type: "year_range", required: false },
      { id: "cmv3", label: "Modèl", type: "list", required: true },
      { id: "cmv4", label: "Page", type: "list", required: false }, // reserved
      { id: "cmv5", label: "make", type: "list", required: false }, // taken
    ];
    expect(urlName("A5 Convertible (8F7)")).toBe("a5-convertible-8f7");
    const p = parsePicks(
      new URLSearchParams("make=Tata&model-year=2020&model=nexon&page=2"),
      real,
    )!;
    expect([...p.entries()]).toEqual([
      ["cmv1", "Tata"],
      ["cmv2", 2020],
      ["cmv3", "nexon"],
    ]);
    // ids still work, and win over a name
    const q = parsePicks(new URLSearchParams("cmv1=AUDI&make=Tata"), real)!;
    expect(q.get("cmv1")).toBe("AUDI");
    p.set("cmv4", "x");
    p.set("cmv5", "y");
    expect(picksLinkQuery(real, p).toString()).toBe(
      "make=Tata&model-year=2020&model=nexon&cmv4=x&cmv5=y",
    );
    // analytics and the page data keep field ids
    expect(picksQuery(real, p).get("cmv1")).toBe("Tata");
  });

  it("labels a selection with every pick in dropdown order", () => {
    const p = parsePicks(
      new URLSearchParams("make=AUDI&year=2008&model=A6 C6 Avant (4F5)"),
      fields,
    )!;
    expect(selectionLabel(fields, p)).toBe("AUDI 2008 A6 C6 Avant (4F5)");
    p.set("engine", "2.0 TDI");
    expect(selectionLabel(fields, p)).toBe(
      "AUDI 2008 A6 C6 Avant (4F5) 2.0 TDI",
    );
    expect(selectionLabel(fields, new Map([["make", "BMW"]]))).toBe("BMW");
  });

  it("sorts years newest first and text naturally", () => {
    expect(sortOptions("year_range", ["2008", "2021", "1999"])).toEqual([
      "2021",
      "2008",
      "1999",
    ]);
    expect(sortOptions("list", ["Model 10", "model 2", "Audi"])).toEqual([
      "Audi",
      "model 2",
      "Model 10",
    ]);
  });
});

describe("results page (Liquid)", () => {
  const config = buildStorefrontConfig({
    config: searchConfig,
    fields: fieldRows,
    stored: {},
  });
  const view = (over: Partial<ResultsView> = {}): ResultsView => ({
    config,
    picks: { make: "AUDI" },
    label: "AUDI 2008 A6",
    complete: true,
    results: {
      products: [
        { handle: "shock-front", universal: false },
        { handle: "bad'handle{{", universal: false },
      ],
      total: 40,
      page: 2,
      pageCount: 3,
      facets: [],
    },
    settings: defaultResultsPage(),
    state: { filterPicks: {}, sort: "match", page: 2 },
    href: (st) =>
      `/apps/sparefit/results?make=AUDI&page=${st.page}${Object.entries(
        st.filterPicks,
      )
        .flatMap(([id, vs]) => vs.map((v) => `&f_${id}=${v}`))
        .join("")}`,
    pickQuery: [["make", "AUDI"]],
    ...over,
  });

  it("renders cards from all_products and skips unsafe handles", () => {
    const html = resultsLiquid(view());
    expect(html).toContain("all_products['shock-front']");
    expect(html).not.toContain("bad'handle");
    expect(html).toContain("Parts that fit your vehicle");
    expect(html).toContain("Fits your vehicle");
  });

  it("escapes merchant text so it can't open Liquid or HTML", () => {
    const html = resultsLiquid(
      view({ picks: { make: "<b>{{ shop.email }}</b>" } }),
    );
    expect(html).not.toContain("{{ shop.email }}");
    expect(html).not.toContain("<b>{");
    expect(escapeLiquidText("{% x %}")).toBe("&#123;&#37; x &#37;&#125;");
  });

  it("links previous and next pages", () => {
    const html = resultsLiquid(view());
    expect(html).toContain('rel="prev"');
    expect(html).toContain('rel="next"');
    expect(html).toContain("2 / 3");
  });

  it("shows the no-results text and the pick-first text", () => {
    const none = resultsLiquid(
      view({
        results: {
          products: [],
          total: 0,
          page: 1,
          pageCount: 1,
          facets: [],
        },
      }),
    );
    expect(none).toContain("No parts fit this selection yet.");
    const incomplete = resultsLiquid(view({ complete: false, results: null }));
    expect(incomplete).toContain(
      "Select your vehicle to see the parts that fit.",
    );
    expect(incomplete).toContain("data-sp-search");
  });

  it("lists filters from tags with counts, picked values linked off, and Clear all", () => {
    const brand = {
      id: "b1",
      label: "Brand",
      tags: ["Bilstein", "KYB"],
      style: "list" as const,
    };
    const html = resultsLiquid(
      view({
        state: { filterPicks: { b1: ["kyb"] }, sort: "match", page: 1 },
        results: {
          products: [{ handle: "shock-front", universal: false }],
          total: 1,
          page: 1,
          pageCount: 1,
          facets: [
            {
              filter: brand,
              values: [
                { value: "Bilstein", count: 3, on: false },
                { value: "KYB", count: 1, on: true },
              ],
            },
          ],
        },
      }),
    );
    expect(html).toContain('class="sp-rp__side"');
    expect(html).toContain("Brand");
    // Picking Bilstein adds it to KYB; KYB's link removes it.
    expect(html).toContain("page=1&#38;f_b1=kyb&#38;f_b1=bilstein");
    expect(html).toMatch(/is-on" href="[^"]*page=1"[^>]*aria-checked="true"/);
    expect(html).toContain('<span class="sp-rp__n">3</span>');
    expect(html).toContain("Clear all");
    expect(html).toContain("Filters (1)");
    // The sort form keeps the picks and filter picks.
    expect(html).toContain('<input type="hidden" name="f_b1" value="kyb">');
    expect(html).toContain("--sp-cols:4;--sp-mcols:2");
  });

  it("lays filters out as a sidebar, dropdowns or a drawer, with Show more and an optional sort", () => {
    const brand = {
      id: "b1",
      label: "Brand",
      tags: ["Bilstein", "KYB"],
      style: "list" as const,
    };
    const values = Array.from({ length: 14 }, (_, i) => ({
      value: `B${String(i).padStart(2, "0")}`,
      count: 1,
      on: i === 12,
    }));
    const page = (over: Partial<ResultsView["settings"]>) =>
      resultsLiquid(
        view({
          settings: { ...defaultResultsPage(), ...over },
          state: { filterPicks: { b1: ["b12"] }, sort: "match", page: 1 },
          results: {
            products: [{ handle: "shock-front", universal: false }],
            total: 1,
            page: 1,
            pageCount: 1,
            facets: [{ filter: brand, values }],
          },
        }),
      );
    const side = page({});
    expect(side).toContain("sp-rp--vertical");
    expect(side).toContain("Show 9 more"); // default: first 5
    // The picked value is in the rest: that part starts open, and so does the group.
    expect(side).toContain('<details class="sp-rp__more" open>');
    expect(side).toContain('<span class="sp-rp__sorttxt">Sort by</span>');
    expect(page({ filterSide: "right" })).toContain("sp-rp--right");
    expect(page({ valuesShown: "all" })).not.toContain("more</summary>");
    expect(page({ valuesShown: "10" })).toContain("Show 4 more");
    // Old saved checkbox values still read: true = all open, false = all closed.
    expect(
      parseResultsPage({ ...defaultResultsPage(), groupsOpen: false })
        ?.groupsOpen,
    ).toBe("none");
    const closed = page({ groupsOpen: "none" });
    expect(closed).toContain('<details class="sp-rp__g" open>'); // has a pick

    const bar = page({ filterLayout: "horizontal" });
    expect(bar).toContain("sp-rp--horizontal");
    expect(bar).toContain('<details class="sp-rp__dd" name="sp-rp-dd">');
    expect(bar).not.toContain('class="sp-rp__side"');

    const drawer = page({ filterLayout: "drawer", showSort: false });
    expect(drawer).toContain('class="sp-rp__drawer"');
    // The filter icon: its name for screen readers, the number of picked tags as a badge.
    expect(drawer).toContain('class="sp-rp__fbtn" title="Filters (1)"');
    expect(drawer).toContain('<span class="sp-rp-vh">Filters (1)</span>');
    expect(drawer).toContain(
      '<span class="sp-rp__fbadge" aria-hidden="true">1</span>',
    );
    expect(drawer).not.toContain('<span class="sp-rp__sorttxt">Sort by</span>');
  });

  it("fills whole rows: products per page = products per row × rows, at most 20", () => {
    const per = (columns: string, rowsPerPage: number) =>
      productsPerPage({ columns, rowsPerPage });
    expect(per("4", 5)).toBe(20);
    expect(per("3", 6)).toBe(18);
    expect(per("3", 9)).toBe(18); // too many rows for 20 products: 6
    expect(per("5", 2)).toBe(10);
    expect(per("2", 10)).toBe(20);
    expect(maxRows(5)).toBe(4);
  });

  it("shows the fits badge, price and SKU on cards as set", () => {
    const page = (over: Partial<ResultsView["settings"]>) =>
      resultsLiquid(view({ settings: { ...defaultResultsPage(), ...over } }));
    const base = page({});
    expect(base).toContain('<span class="sp-card__fit">');
    expect(base).toContain("{{ sp_p.price | money }}");
    expect(base).not.toContain('<span class="sp-card__sku">');
    const custom = page({ cardFit: false, cardPrice: false, cardSku: true });
    expect(custom).not.toContain('<span class="sp-card__fit">');
    expect(custom).not.toContain("sp_p.price | money");
    expect(custom).toContain("{%- assign sp_sku = sp_sv.sku -%}");
  });

  it("shows sale prices, Sold out and the brand, and shapes the images", () => {
    const page = (over: Partial<ResultsView["settings"]>) =>
      resultsLiquid(view({ settings: { ...defaultResultsPage(), ...over } }));
    const base = page({});
    expect(base).toContain("sp_sv.compare_at_price > sp_sv.price");
    expect(base).toContain("{%- unless sp_p.available -%}");
    expect(base).not.toContain("sp_p.vendor");
    expect(base).toContain("--sp-ar:1");
    const custom = page({
      cardCompare: false,
      cardSoldOut: false,
      cardVendor: true,
      cardImage: "portrait",
    });
    expect(custom).not.toContain("compare_at_price");
    expect(custom).not.toContain("sp_p.available");
    expect(custom).toContain("{{ sp_p.vendor | escape }}");
    expect(custom).toContain("--sp-ar:3 / 4");
  });

  it("shows Sale and the picked tags as badges", () => {
    const html = resultsLiquid(
      view({
        settings: {
          ...defaultResultsPage(),
          badgeSale: true,
          badgeTags: [
            {
              tag: "New",
              bg: "#FFEE00",
              color: "#111111",
              active: true,
              label: "",
            },
            {
              tag: "<b>Hot</b>",
              bg: "#FFFFFF",
              color: "#1A1A1A",
              active: true,
              label: "",
            },
            // Turned off: never shows.
            {
              tag: "Old",
              bg: "#FFFFFF",
              color: "#1A1A1A",
              active: false,
              label: "",
            },
          ],
        },
        results: {
          products: [
            { handle: "a", universal: false },
            { handle: "b", universal: false },
          ],
          tagsByHandle: { a: ["new", "<b>hot</b>"], b: ["Old"] },
          total: 2,
          page: 1,
          pageCount: 1,
          facets: [],
        },
      }),
    );
    expect(html).toContain('<span class="sp-card__sale">Sale</span>');
    expect(html.match(/class="sp-card__tb"/g)).toHaveLength(2);
    // Each tag badge in its own colours; Sold out, Sale, shapes and the gap as page variables.
    expect(html).toContain(
      '<span class="sp-card__tb" style="background:#FFEE00;color:#111111">New</span>',
    );
    expect(html).toMatch(
      /--sp-badge-r:999px;--sp-badge-fw:600;--sp-so-bg:#1A1A1A/,
    );
    expect(html).toContain("--sp-gap:20px");
    expect(html).not.toContain("<b>Hot</b></span>");
    const plain = resultsLiquid(view({ settings: defaultResultsPage() }));
    expect(plain).not.toContain('sp-card__sale">Sale');
    expect(plain).not.toContain('<span class="sp-card__tb">');
  });

  it("shows the Add to cart button only when set, from Shopify's availability", () => {
    const off = resultsLiquid(view({ settings: defaultResultsPage() }));
    expect(off).not.toContain('class="sp-card__cart"');
    const on = resultsLiquid(
      view({ settings: { ...defaultResultsPage(), cardCart: true } }),
    );
    expect(on).toContain('action="{{ routes.cart_add_url }}"');
    expect(on).toContain("{%- if sp_p.available -%}");
    expect(on).toContain(
      "sp_p.variants_count == 1 and sp_p.requires_selling_plan == false",
    );
    expect(on).toContain(">Choose options</a>");
    expect(on).toContain("disabled>Sold out</button>");
    // The button sits outside the product link (no form inside an <a>).
    expect(on).toMatch(/<\/a>\s*\{%- if sp_p\.available/);
  });

  it("applies the page width, card looks, button text and sticky sidebar", () => {
    const base = resultsLiquid(view({ settings: defaultResultsPage() }));
    expect(base).toContain('<div class="page-width sp-results-outer">');
    expect(base).not.toMatch(
      /class="sp-rp [^"]*sp-rp--(contain|t1|tfull|center|outline|static)/,
    );
    expect(base).not.toContain("sp_p.images[1]");
    const html = resultsLiquid(
      view({
        settings: {
          ...defaultResultsPage(),
          pageWidth: "full",
          imageFit: "contain",
          imageHover: true,
          titleLines: "1",
          cardAlign: "center",
          cardCart: true,
          cartText: "Buy <now>",
          cartStyle: "outline",
          stickySide: false,
        },
      }),
    );
    expect(html).toContain(
      '<div class="sp-results-outer"><div class="sp-results sp-results--full"',
    );
    for (const c of ["contain", "hover", "t1", "center", "outline", "static"])
      expect(html).toMatch(new RegExp(`class="sp-rp [^"]*sp-rp--${c}`));
    expect(html).toContain("{%- if sp_p.images[1] -%}");
    const custom = resultsLiquid(
      view({
        settings: {
          ...defaultResultsPage(),
          pageWidth: "custom",
          pageMaxWidth: 1100,
        },
      }),
    );
    expect(custom).toContain(
      'class="sp-results sp-results--full" style="--sp-pw:1100px"',
    );
    expect(html).toContain('class="sp-card__btn">Buy &#60;now&#62;</button>');
  });

  it("shows the no-results message and button, and Load more", () => {
    const results = (over: Partial<NonNullable<ResultsView["results"]>>) => ({
      products: [],
      total: 0,
      page: 1,
      pageCount: 1,
      facets: [],
      ...over,
    });
    const empty = resultsLiquid(
      view({
        settings: {
          ...defaultResultsPage(),
          emptyText: "Nothing for this one",
          emptyButton: "Browse all",
          emptyUrl: "/collections/all",
        },
        results: results({}),
      }),
    );
    expect(empty).toContain("Nothing for this one");
    expect(empty).toContain('href="/collections/all">Browse all</a>');
    const unsafe = resultsLiquid(
      view({
        settings: {
          ...defaultResultsPage(),
          emptyButton: "Go",
          emptyUrl: "javascript:alert(1)",
        },
        results: results({}),
      }),
    );
    expect(unsafe).not.toContain("javascript:");
    const products = Array.from({ length: 4 }, (_, i) => ({
      handle: `p-${i}`,
      universal: false,
    }));
    const more = resultsLiquid(
      view({
        settings: { ...defaultResultsPage(), paging: "more" },
        results: results({ products, total: 10, pageCount: 3 }),
      }),
    );
    expect(more).toContain("Showing 4 of 10");
    expect(more).toContain('rel="next" data-sp-more>Load more</a>');
    expect(more).not.toContain('<nav class="sp-pager"');
  });

  it("rejects a no-results link that isn't a path or http(s)", () => {
    const doc = (emptyUrl: string) =>
      parseResultsPage({ ...defaultResultsPage(), emptyUrl });
    expect(doc("/collections/all")).not.toBeNull();
    expect(doc("https://example.com/a")).not.toBeNull();
    expect(doc("")).not.toBeNull();
    expect(doc("javascript:alert(1)")).toBeNull();
    expect(doc("//evil.test")).toBeNull();
  });

  it("reads tag badges saved as plain tags, and sets the button and badge looks", () => {
    expect(
      parseResultsPage({ ...defaultResultsPage(), badgeTags: ["New"] })
        ?.badgeTags,
    ).toEqual([
      { tag: "New", bg: "#FFFFFF", color: "#1A1A1A", active: true, label: "" },
    ]);
    expect(
      parseResultsPage({ ...defaultResultsPage(), cartBg: "red" }),
    ).toBeNull();
    const html = resultsLiquid(
      view({
        settings: {
          ...defaultResultsPage(),
          cartShape: "square",
          cartBg: "#112233",
          cartColor: "#FFEEDD",
          badgeShape: "rounded",
          badgeSize: 13,
          badgeWeight: "700",
          cardGap: 32,
          cardGapMobile: 8,
        },
      }),
    );
    expect(html).toContain(
      "--sp-gap:32px;--sp-mgap:8px;--sp-cbtn-r:0;--sp-cbtn-bg:#112233;--sp-cbtn-fg:#FFEEDD;--sp-badge-r:6px;--sp-badge-fs:13px;--sp-badge-fw:700",
    );
    // Without own colours the button keeps the search widget's colour.
    expect(
      resultsLiquid(view({ settings: defaultResultsPage() })),
    ).not.toContain(";--sp-cbtn-bg:");
  });

  it("shows badge labels instead of the tag, and colours the prices", () => {
    const html = resultsLiquid(
      view({
        settings: {
          ...defaultResultsPage(),
          badgeSale: true,
          soldOutLabel: "Uitverkocht",
          saleLabel: "",
          priceColor: "#B42318",
          comparePriceColor: "#777777",
          badgeTags: [
            {
              tag: "new",
              bg: "#FFFFFF",
              color: "#1A1A1A",
              active: true,
              label: "Fresh",
            },
            {
              tag: "oem",
              bg: "#FFFFFF",
              color: "#1A1A1A",
              active: true,
              label: "",
            },
          ],
        },
        results: {
          products: [{ handle: "a", universal: false }],
          tagsByHandle: { a: ["new", "oem"] },
          total: 1,
          page: 1,
          pageCount: 1,
          facets: [],
        },
      }),
    );
    expect(html).toContain('<span class="sp-card__so">Uitverkocht</span>');
    expect(html).toContain('<span class="sp-card__sale">Sale</span>');
    expect(html).toContain('color:#1A1A1A">Fresh</span>');
    expect(html).toContain('color:#1A1A1A">oem</span>');
    expect(html).toContain("--sp-price:#B42318;--sp-was:#777777");
    expect(
      parseResultsPage({ ...defaultResultsPage(), priceColor: "black" }),
    ).toBeNull();
  });

  it("prints every merchant text as text: no HTML, no Liquid", () => {
    const evil = '{{ shop.name }}<b x="1">{% render x %}';
    const html = resultsLiquid(
      view({
        settings: {
          ...defaultResultsPage(),
          pageTitle: evil,
          filterTitle: evil.slice(0, 40),
          cardCart: true,
          cartText: evil.slice(0, 40),
          badgeSale: true,
          soldOutLabel: evil.slice(0, 40),
          saleLabel: evil.slice(0, 40),
          emptyText: evil,
          emptyButton: evil.slice(0, 40),
          emptyUrl: "/collections/all",
          badgeTags: [
            {
              tag: "new",
              bg: "#FFFFFF",
              color: "#1A1A1A",
              active: true,
              label: evil.slice(0, 40),
            },
          ],
        },
        results: {
          products: [{ handle: "a", universal: false }],
          tagsByHandle: { a: ["new"] },
          total: 1,
          page: 1,
          pageCount: 1,
          facets: [],
        },
      }),
    );
    expect(html).not.toContain("{{ shop.name }}");
    expect(html).not.toContain("{% render x %}");
    expect(html).not.toContain('<b x="1">');
    expect(html).toContain("&#123;&#123; shop.name &#125;&#125;");
  });

  it("accepts store paths and http(s) links only for the no-results button", () => {
    for (const ok of [
      "/collections/all",
      "/pages/contact?x=1",
      "https://shop.example/a",
    ])
      expect(SAFE_LINK.test(ok)).toBe(true);
    for (const bad of [
      "//evil.test",
      "/\\evil.test",
      "javascript:alert(1)",
      'https://x" onmouseover="a',
      "https://a b",
      "mailto:a@b.c",
    ])
      expect(SAFE_LINK.test(bad)).toBe(false);
  });

  it("reads older saved settings, and keeps the rest when one field is no longer valid", () => {
    const stored = (doc: object) => storedResultsPage({ [RESULTS_KEY]: doc });
    // A sort removed later, plain-tag badges, a boolean for groups open.
    const old = stored({
      sort: "sku-asc",
      badgeTags: ["New"],
      groupsOpen: false,
    });
    expect(old.sort).toBe("match");
    expect(old.badgeTags).toEqual([
      { tag: "New", bg: "#FFFFFF", color: "#1A1A1A", active: true, label: "" },
    ]);
    expect(old.groupsOpen).toBe("none");
    // Too many badges (or duplicates in any case) are refused when saved…
    const many = Array.from({ length: 11 }, (_, i) => `t${i}`);
    expect(
      parseResultsPage({ ...defaultResultsPage(), badgeTags: many }),
    ).toBeNull();
    expect(
      parseResultsPage({
        ...defaultResultsPage(),
        badgeTags: ["Sale", "sale"],
      }),
    ).toBeNull();
    // …and when read, only that field goes back to its default.
    const kept = stored({ badgeTags: many, columns: "3", pageTitle: "Mine" });
    expect(kept.badgeTags).toEqual([]);
    expect([kept.columns, kept.pageTitle]).toEqual(["3", "Mine"]);
  });

  it("styles the page title, or leaves it out", () => {
    const page = (over: Partial<ResultsView["settings"]>) =>
      resultsLiquid(view({ settings: { ...defaultResultsPage(), ...over } }));
    expect(page({})).toContain(
      '<h1 class="sp-results__title" style="text-align:left">',
    );
    expect(
      page({ titleAlign: "center", titleSize: 44, titleColor: "#123ABC" }),
    ).toContain('style="text-align:center;font-size:44px;color:#123ABC"');
    expect(page({ titleSize: 44, titleSizeMobile: 28 })).toContain(
      'style="text-align:left;font-size:44px;--sp-tsm:28px"',
    );
    expect(page({ titleWeight: "700" })).toContain(
      'style="text-align:left;font-weight:700"',
    );
    expect(page({ showTitle: false })).not.toContain("<h1");
    // Sizes saved as words before px still read; a colour that isn't #RRGGBB never reaches the page.
    expect(
      parseResultsPage({ ...defaultResultsPage(), titleSize: "large" })
        ?.titleSize,
    ).toBe(44);
    expect(
      parseResultsPage({ ...defaultResultsPage(), titleColor: "red;x:y" }),
    ).toBeNull();
  });

  it("uses the merchant's page title, or the store type's one when empty", () => {
    expect(resultsLiquid(view())).toContain("Parts that fit your vehicle");
    const custom = resultsLiquid(
      view({
        settings: {
          ...defaultResultsPage(),
          pageTitle: "Shocks for {{ you }}",
        },
      }),
    );
    expect(custom).toContain("Shocks for &#123;&#123; you &#125;&#125;");
    expect(custom).not.toContain("Parts that fit your vehicle");
  });

  it("filters without a page reload: one script, no Liquid in it, links still work without it", () => {
    const html = resultsLiquid(view());
    const script = html.slice(html.indexOf("<script>"));
    expect(script).toContain("history.pushState");
    expect(script).not.toMatch(/\{\{|\{%/);
    // The sort no longer submits on its own; the script (or the no-JS Sort button) does.
    expect(html).not.toContain("onchange");
    expect(html).toContain(
      '<noscript><button type="submit">Sort</button></noscript>',
    );
  });

  it("opens all groups, only the first, or none (a group with a pick stays open)", () => {
    const g = (id: string, picked: boolean) => ({
      filter: { id, label: id.toUpperCase(), tags: ["One", "Two"] },
      values: [
        { value: "One", count: 1, on: picked },
        { value: "Two", count: 1, on: false },
      ],
    });
    const page = (groupsOpen: "all" | "first" | "none", pickSecond = false) =>
      resultsLiquid(
        view({
          settings: { ...defaultResultsPage(), groupsOpen },
          results: {
            products: [{ handle: "shock-front", universal: false }],
            total: 1,
            page: 1,
            pageCount: 1,
            facets: [g("a", false), g("b", pickSecond), g("c", false)],
          },
        }),
      );
    const openCount = (html: string) =>
      (html.match(/<details class="sp-rp__g" open>/g) ?? []).length;
    expect(openCount(page("all"))).toBe(3);
    expect(openCount(page("first"))).toBe(1);
    expect(openCount(page("none"))).toBe(0);
    expect(openCount(page("none", true))).toBe(1);
  });

  it("shows the result count and Sort by only when they are on", () => {
    const page = (over: Partial<ResultsView["settings"]>) =>
      resultsLiquid(view({ settings: { ...defaultResultsPage(), ...over } }));
    expect(page({})).toContain('<p class="sp-rp__count">40 results</p>');
    expect(page({ showCount: false })).not.toContain('class="sp-rp__count"');
    const neither = page({ showCount: false, showSort: false });
    expect(neither).not.toContain('<div class="sp-rp__bar">');
  });

  it("has no filter bar without filters, and says when filters match nothing", () => {
    expect(resultsLiquid(view())).toContain("sp-rp--nofilters");
    const none = resultsLiquid(
      view({
        state: { filterPicks: { b1: ["x"] }, sort: "match", page: 1 },
        results: {
          products: [],
          total: 0,
          page: 1,
          pageCount: 1,
          facets: [],
        },
      }),
    );
    expect(none).toContain("No parts match these filters.");
  });
});

describe("theme search plan", () => {
  it("searches the theme for the SKUs, one OR'ed phrase per SKU", () => {
    const plan = searchPlan({
      skus: ["47-116573", "35 217 480"],
      products: 2,
      withoutSku: 0,
    });
    expect(plan).toEqual({
      mode: "search",
      q: `${SKU_FIELD}:"47-116573" OR ${SKU_FIELD}:"35 217 480"`,
      skus: 2,
      missing: 0,
    });
  });

  it("leaves out products without a usable SKU and counts them", () => {
    const plan = searchPlan({ skus: ["A", 'B"1'], products: 3, withoutSku: 1 });
    expect(plan).toMatchObject({ mode: "search", skus: 1, missing: 2 });
  });

  it("always searches the theme: no match when nothing is searchable", () => {
    for (const found of [
      { skus: [], products: 0, withoutSku: 0 },
      { skus: [], products: 2, withoutSku: 2 },
    ]) {
      expect(searchPlan(found)).toEqual({
        mode: "search",
        q: NO_MATCH_QUERY,
        skus: 0,
        missing: found.products,
      });
    }
  });

  it("puts as many SKUs in the link as fit, and counts the rest as missing", () => {
    const many = Array.from({ length: 400 }, (_, i) => `SKU-${i}`);
    const plan = searchPlan({ skus: many, products: 400, withoutSku: 0 });
    expect(plan.mode).toBe("search");
    expect(encodeURIComponent(plan.q).length).toBeLessThanOrEqual(
      MAX_QUERY_LENGTH,
    );
    expect(plan.skus).toBeGreaterThan(100);
    expect(plan.skus).toBeLessThan(400);
    expect(plan.missing).toBe(400 - plan.skus);
    expect(plan.q.startsWith(`${SKU_FIELD}:"SKU-0" OR `)).toBe(true);
  });
});
