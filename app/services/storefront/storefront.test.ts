// Storefront settings, config, picks and the results page (pure; M7).
import { describe, expect, it } from "vitest";
import { MAX_SEARCH_SKUS, SKU_FIELD, searchPlan } from "./search-query";
import { defaultSettings, resolveSettings } from "./settings";
import { buildStorefrontConfig, PROXY_PATH } from "./config";
import {
  isComplete,
  parsePicks,
  picksBefore,
  picksKey,
  picksQuery,
  selectionLabel,
  sortOptions,
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
    expect(s.msAdd).toBe("Add a vehicle");
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

  it("labels a selection like My Selection (year, first and last dropdown)", () => {
    const p = parsePicks(
      new URLSearchParams("make=AUDI&year=2008&model=A6 C6 Avant (4F5)"),
      fields,
    )!;
    expect(selectionLabel(fields, p)).toBe("2008 AUDI A6 C6 Avant (4F5)");
    p.set("engine", "2.0 TDI");
    expect(selectionLabel(fields, p)).toBe("2008 AUDI 2.0 TDI");
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
    label: "2008 AUDI A6",
    complete: true,
    results: {
      products: [
        { handle: "shock-front", universal: false },
        { handle: "bad'handle{{", universal: false },
      ],
      collections: [{ handle: "brakes", title: "Brakes & {{ more }}" }],
      total: 40,
      page: 2,
      pageCount: 3,
    },
    pageHref: (n) => `/apps/fitfinder/results?make=AUDI&page=${n}`,
    ...over,
  });

  it("renders cards from all_products and skips unsafe handles", () => {
    const html = resultsLiquid(view());
    expect(html).toContain("all_products['shock-front']");
    expect(html).not.toContain("bad'handle");
    expect(html).toContain("Parts that fit your vehicle");
    expect(html).toContain("Fits your vehicle");
    expect(html).toContain('href="{{ routes.collections_url }}/brakes"');
  });

  it("escapes merchant text so it can't open Liquid or HTML", () => {
    const html = resultsLiquid(view({ label: "<b>{{ shop.email }}</b>" }));
    expect(html).not.toContain("{{ shop.email }}");
    expect(html).not.toContain("{{ more }}");
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
          collections: [],
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
    expect(incomplete).toContain("data-ff-search");
  });
});

describe("theme search plan", () => {
  it("searches the theme for the SKUs, one OR'ed phrase per SKU", () => {
    const plan = searchPlan({ skus: ["47-116573", "35 217 480"], products: 2, withoutSku: 0 });
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

  it("uses FitFinder's page when nothing fits, nothing is searchable or the list is too long", () => {
    expect(searchPlan({ skus: [], products: 0, withoutSku: 0 })).toEqual({ mode: "page", reason: "none" });
    expect(searchPlan({ skus: [], products: 2, withoutSku: 2 })).toEqual({ mode: "page", reason: "unsearchable" });
    const many = Array.from({ length: MAX_SEARCH_SKUS + 1 }, (_, i) => `S${i}`);
    expect(searchPlan({ skus: many, products: many.length, withoutSku: 0 })).toEqual({
      mode: "page",
      reason: "too-many",
    });
    const long = Array.from({ length: 50 }, (_, i) => `${"X".repeat(150)}${i}`);
    expect(searchPlan({ skus: long, products: 50, withoutSku: 0 })).toEqual({ mode: "page", reason: "too-many" });
  });
});
