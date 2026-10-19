// Storefront settings, config, picks and the results page (pure; M7).
import { describe, expect, it } from "vitest";
import {
  MAX_QUERY_LENGTH,
  NO_MATCH_QUERY,
  SKU_FIELD,
  searchPlan,
} from "./search-query";
import { defaultSettings, resolveSettings } from "./settings";
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
    expect(selectionLabel(fields, p)).toBe("AUDI 2008 A6 C6 Avant (4F5) 2.0 TDI");
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
    },
    pageHref: (n) => `/apps/sparefit/results?make=AUDI&page=${n}`,
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
    const html = resultsLiquid(view({ label: "<b>{{ shop.email }}</b>" }));
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
