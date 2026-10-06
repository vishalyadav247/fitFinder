// App proxy routes (M7): signature check first, unknown shops 404, input validated before any
// query, ids mapped to Admin gids, results as a Liquid page.
import { beforeEach, describe, expect, it, vi } from "vitest";

const appProxy = vi.fn();
const shopSearch = vi.fn();
const fieldOptions = vi.fn();
const productFits = vi.fn();
const searchResults = vi.fn();
const fitSkus = vi.fn();
const loadStorefrontConfig = vi.fn();

vi.mock("../db.server", () => ({ default: {} }));
vi.mock("../shopify.server", () => ({
  authenticate: { public: { appProxy } },
}));
vi.mock("../services/storefront/query.server", () => ({
  shopSearch,
  fieldOptions,
  productFits,
  searchResults,
  fitSkus,
}));
vi.mock("../services/storefront/sync.server", () => ({
  loadStorefrontConfig,
}));

const { loader: options } = await import("../routes/proxy.options");
const { loader: fits } = await import("../routes/proxy.fits");
const { loader: results } = await import("../routes/proxy.results");
const { loader: searchRoute } = await import("../routes/proxy.search");
const { buildStorefrontConfig } = await import("../services/storefront/config");

const SHOP = "shop=demo.myshopify.com&signature=x&timestamp=1";
const search = {
  shopId: "shop_1",
  dataVersion: 3,
  fields: [
    { id: "make", label: "Make", type: "list", required: true },
    { id: "year", label: "Year", type: "year_range", required: true },
    { id: "model", label: "Model", type: "list", required: true },
  ],
};

const call = async (
  loader: (args: never) => Promise<Response> | Response,
  path: string,
  query: string,
) => {
  try {
    return await loader({
      request: new Request(`https://app.test/proxy/${path}?${SHOP}&${query}`),
      params: {},
      context: {},
    } as never);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
};

beforeEach(async () => {
  vi.clearAllMocks();
  (await import("../services/storefront/limits.server")).resetLimits();
  appProxy.mockResolvedValue({});
  shopSearch.mockResolvedValue(search);
});

describe("app proxy", () => {
  it("refuses a bad signature before reading anything", async () => {
    appProxy.mockRejectedValue(new Response(undefined, { status: 400 }));
    expect((await call(options, "options", "field=make")).status).toBe(400);
    expect(shopSearch).not.toHaveBeenCalled();
  });

  it("404s for shops that are unknown, uninstalled or not set up", async () => {
    shopSearch.mockResolvedValue(null);
    const res = await call(fits, "fits", "product=1");
    expect(res.status).toBe(404);
    expect(shopSearch).toHaveBeenCalledWith("demo.myshopify.com");
  });
});

describe("GET options", () => {
  it("returns the values for a field with the picks", async () => {
    fieldOptions.mockResolvedValue(["2011", "2010"]);
    const res = await call(options, "options", "field=year&make=AUDI");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ options: ["2011", "2010"] });
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=30");
    const [s, index, picks] = fieldOptions.mock.calls[0];
    expect(s).toBe(search);
    expect(index).toBe(1);
    expect([...picks.entries()]).toEqual([["make", "AUDI"]]);
  });

  it("refuses unknown fields and bad picks", async () => {
    for (const q of ["field=nope", "", "field=model&year=20x8"]) {
      expect((await call(options, "options", q)).status).toBe(400);
    }
    expect(fieldOptions).not.toHaveBeenCalled();
  });
});

describe("GET fits", () => {
  it("maps Liquid ids to Admin gids", async () => {
    productFits.mockResolvedValue({
      state: "fits",
      universal: false,
      rows: [],
      total: 0,
    });
    const res = await call(
      fits,
      "fits",
      "product=123&collections=7,8&make=AUDI",
    );
    expect(res.status).toBe(200);
    const [, product, collections, picks] = productFits.mock.calls[0];
    expect(product).toBe("gid://shopify/Product/123");
    expect(collections).toEqual([
      "gid://shopify/Collection/7",
      "gid://shopify/Collection/8",
    ]);
    expect(picks.get("make")).toBe("AUDI");
  });

  it("refuses bad ids", async () => {
    for (const q of [
      "product=abc",
      "product=1&collections=1,x",
      `product=1&collections=${Array.from({ length: 101 }, (_, i) => i).join(",")}`,
      "product=1&year=1",
    ]) {
      expect((await call(fits, "fits", q)).status).toBe(400);
    }
    expect(productFits).not.toHaveBeenCalled();
  });
});

describe("GET results", () => {
  const config = buildStorefrontConfig({
    config: {
      storeType: "automotive",
      heading: "Find parts",
      noun: "vehicle",
      thingsWord: "parts",
    },
    fields: search.fields.map((f, position) => ({
      ...f,
      placeholder: "",
      position,
    })) as never,
    stored: {},
  });

  it("renders a Liquid page with the products that fit", async () => {
    loadStorefrontConfig.mockResolvedValue(config);
    searchResults.mockResolvedValue({
      products: [{ handle: "shock", universal: false }],
      collections: [],
      total: 1,
      page: 1,
      pageCount: 1,
    });
    const res = await call(results, "results", "make=AUDI&year=2008&model=A6");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/liquid");
    const body = await res.text();
    expect(body).toContain("all_products['shock']");
    expect(body).toContain("2008 AUDI A6");
    expect(searchResults.mock.calls[0][2]).toBe(1);
  });

  it("asks for the selection first when it is incomplete", async () => {
    loadStorefrontConfig.mockResolvedValue(config);
    const res = await call(results, "results", "make=AUDI");
    expect(await res.text()).toContain(
      "Select your vehicle to see the parts that fit.",
    );
    expect(searchResults).not.toHaveBeenCalled();
  });

  it("goes back to page 1 past the last page", async () => {
    loadStorefrontConfig.mockResolvedValue(config);
    searchResults
      .mockResolvedValueOnce({
        products: [],
        collections: [],
        total: 0,
        page: 9,
        pageCount: 1,
      })
      .mockResolvedValueOnce({
        products: [],
        collections: [],
        total: 0,
        page: 1,
        pageCount: 1,
      });
    await call(results, "results", "make=AUDI&year=2008&model=A6&page=9");
    expect(searchResults.mock.calls.map((c) => c[2])).toEqual([9, 1]);
  });

  it("refuses bad pages", async () => {
    for (const q of ["page=0", "page=abc", "page=1001"]) {
      expect((await call(results, "results", q)).status).toBe(400);
    }
  });
});

describe("busy store", () => {
  it("answers 429 to script calls over the shop's budget, and a page to shoppers", async () => {
    const { resetLimits, takeToken } =
      await import("../services/storefront/limits.server");
    resetLimits();
    fieldOptions.mockResolvedValue([]);
    // Use up the shop's budget at once (a slow loop would refill it).
    while (takeToken("demo.myshopify.com"));
    const json = await call(options, "options", "field=make");
    expect(json.status).toBe(429);
    expect(json.headers.get("Retry-After")).toBe("1");
    const page = await call(results, "results", "make=AUDI");
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toBe("application/liquid");
    expect(await page.text()).toContain("The search is very busy right now");
    resetLimits();
  });
});

describe("GET search", () => {
  it("returns the theme search query for a full selection", async () => {
    fitSkus.mockResolvedValue({
      skus: ["A-1", "B-2"],
      products: 2,
      withoutSku: 0,
    });
    const res = await call(
      searchRoute,
      "search",
      "make=AUDI&year=2008&model=A6",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mode: "search",
      q: 'variants.sku:"A-1" OR variants.sku:"B-2"',
      skus: 2,
      missing: 0,
    });
    expect([...fitSkus.mock.calls[0][1].entries()]).toEqual([
      ["make", "AUDI"],
      ["year", 2008],
      ["model", "A6"],
    ]);
  });

  it("falls back to FitFinder's page when nothing fits", async () => {
    fitSkus.mockResolvedValue({ skus: [], products: 0, withoutSku: 0 });
    const res = await call(
      searchRoute,
      "search",
      "make=AUDI&year=2008&model=A6",
    );
    expect(await res.json()).toEqual({ mode: "page", reason: "none" });
  });

  it("refuses incomplete selections", async () => {
    expect((await call(searchRoute, "search", "make=AUDI")).status).toBe(400);
    expect(fitSkus).not.toHaveBeenCalled();
  });
});
