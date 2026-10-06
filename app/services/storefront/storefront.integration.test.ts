// Storefront reads against the real Postgres in DATABASE_URL (M7): cascading options with year
// ranges and optional fields, the options cache and data_version, fits (product, collection,
// universal), results (active products, universal last, collections, paging) and shop isolation,
// and the app metafield publish.
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const DOMAIN = "vitest-storefront.myshopify.com";
const OTHER = "vitest-storefront-b.myshopify.com";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env: rely on the environment
}

const { default: prisma } = await import("../../db.server");
const { upsertShopOnInstall } = await import("../../models/shop.server");
const { applyStoreType } = await import("../../models/search-config.server");
const { saveRow, deleteAllRows } =
  await import("../../models/fitment-row.server");
const { applyFieldIntent } = await import("../../models/search-field.server");
const catalog = await import("../linking/catalog.server");
const { relink } = await import("../linking/relink.server");
const q = await import("./query.server");
const { parsePicks } = await import("./picks");
const { publishStorefrontConfig } = await import("./sync.server");

const P = (n: number) => `gid://shopify/Product/${n}`;
const product = (n: number, sku: string, status = "ACTIVE") => ({
  productId: P(n),
  title: `Product ${n}`,
  handle: `product-${n}`,
  status,
  variants: [{ variantId: `gid://shopify/ProductVariant/${n}`, sku }],
});
const NOW = new Date().getUTCFullYear();

describe.skipIf(!process.env.DATABASE_URL)("storefront (Postgres)", () => {
  let shopId: string;
  let otherId: string;
  let ids: { make: string; year: string; model: string };

  const version = async (id = shopId) =>
    (await prisma.searchConfig.findUniqueOrThrow({ where: { shopId: id } }))
      .dataVersion;
  const search = async (domain = DOMAIN) => (await q.shopSearch(domain))!;
  const picks = async (query: string) =>
    parsePicks(new URLSearchParams(query), (await search()).fields)!;
  const add = async (
    id: string,
    make: string,
    years: string,
    model: string,
    attachment: string,
  ) => {
    const f = await prisma.searchField.findMany({
      where: { shopId: id },
      orderBy: { position: "asc" },
    });
    const res = await saveRow(id, null, {
      [f[0].id]: make,
      [f[1].id]: years,
      [f[2].id]: model,
      attachment,
    });
    expect(res.ok).toBe(true);
  };

  afterAll(async () => {
    await prisma.shop.deleteMany({
      where: { domain: { in: [DOMAIN, OTHER] } },
    });
  });

  beforeEach(async () => {
    q.clearOptionsCache();
    await prisma.shop.deleteMany({
      where: { domain: { in: [DOMAIN, OTHER] } },
    });
    shopId = (await upsertShopOnInstall(DOMAIN)).id;
    otherId = (await upsertShopOnInstall(OTHER)).id;
    for (const id of [shopId, otherId]) {
      await applyStoreType(id, "automotive", { replace: false });
    }
    const f = await prisma.searchField.findMany({
      where: { shopId },
      orderBy: { position: "asc" },
    });
    ids = { make: f[0].id, year: f[1].id, model: f[2].id };

    await catalog.replaceCatalog(
      shopId,
      [
        product(1, "SKU-1"),
        product(2, "SKU-2"),
        product(3, "UNI"),
        product(4, "COL"),
        product(5, "SKU-5", "DRAFT"),
      ],
      [
        {
          collectionId: "gid://shopify/Collection/9",
          handle: "brakes",
          title: "Brakes",
        },
      ],
      await catalog.dbNow(),
    );
    await add(shopId, "AUDI", "2008-2011", "A6", "SKU-1");
    await add(shopId, "AUDI", "2016-", "A4", "SKU-2");
    await add(shopId, "BMW", "2015", "X3", "SKU-1");
    await add(shopId, "AUDI", "2009", "A6", "/collections/brakes");
    await add(shopId, "AUDI", "2009", "A6", "SKU-5"); // draft product
    await relink(shopId);
    await prisma.universalProduct.create({ data: { shopId, productId: P(3) } });
    // The other shop: same values, other parts. Must never show up.
    await add(otherId, "AUDI", "2008-2011", "A6", "SKU-1");
    await add(otherId, "SEAT", "2000", "Ibiza", "SKU-9");
  });

  it("cascades dropdown options with expanded year ranges", async () => {
    const s = await search();
    expect(await q.fieldOptions(s, 0, new Map())).toEqual(["AUDI", "BMW"]);
    const years = await q.fieldOptions(s, 1, await picks(`${ids.make}=AUDI`));
    const open = Array.from({ length: NOW - 2016 + 1 }, (_, i) =>
      String(NOW - i),
    );
    expect(years).toEqual([...open, "2011", "2010", "2009", "2008"]);
    expect(
      await q.fieldOptions(
        s,
        2,
        await picks(`${ids.make}=AUDI&${ids.year}=2009`),
      ),
    ).toEqual(["A6"]);
    expect(
      await q.fieldOptions(
        s,
        2,
        await picks(`${ids.make}=AUDI&${ids.year}=2020`),
      ),
    ).toEqual(["A4"]);
    // picks of later fields are ignored
    expect(await q.fieldOptions(s, 0, await picks(`${ids.model}=X3`))).toEqual([
      "AUDI",
      "BMW",
    ]);
  });

  it("treats a missing value of an optional field as any value", async () => {
    await applyFieldIntent(shopId, {
      intent: "required",
      fieldId: ids.model,
      value: false,
    });
    await prisma.$executeRaw`UPDATE fitment_rows SET "values" = "values" - ${ids.model}
      WHERE shop_id = ${shopId} AND attachment = 'SKU-2'`;
    const s = await search();
    const r = await q.searchResults(
      s,
      await picks(`${ids.make}=AUDI&${ids.year}=2020&${ids.model}=A6`),
      1,
    );
    expect(r.products.map((p) => p.handle)).toEqual(["product-2", "product-3"]);
  });

  it("serves cached options until the data version changes", async () => {
    const before = await version();
    let s = await search();
    expect(await q.fieldOptions(s, 0, new Map())).toEqual(["AUDI", "BMW"]);
    await prisma.$executeRaw`DELETE FROM fitment_rows WHERE shop_id = ${shopId} AND "values" @> ${JSON.stringify({ [ids.make]: "BMW" })}::jsonb`;
    expect(await q.fieldOptions(s, 0, new Map())).toEqual(["AUDI", "BMW"]); // same version: cached
    await add(shopId, "VOLVO", "2016", "XC90", "SKU-7");
    expect(await version()).toBe(before + 1);
    s = await search();
    expect(await q.fieldOptions(s, 0, new Map())).toEqual(["AUDI", "VOLVO"]);
  });

  it("bumps the data version on field changes, deletes and store type replace", async () => {
    let v = await version();
    await applyFieldIntent(shopId, {
      intent: "label",
      fieldId: ids.model,
      value: "Type",
    });
    expect(await version()).toBe(++v);
    await deleteAllRows(shopId);
    expect(await version()).toBe(++v);
    await applyStoreType(shopId, "phones", { replace: true });
    expect(await version()).toBe(++v);
    expect(await version(otherId)).toBe(0 + 2); // its own two rows only
  });

  it("checks whether a product fits and lists its rows", async () => {
    const s = await search();
    const p1 = await q.productFits(s, P(1), [], new Map());
    expect(p1.state).toBe("ask");
    expect(p1.total).toBe(2);
    expect(p1.rows).toEqual(
      expect.arrayContaining([
        { v: { [ids.make]: "AUDI", [ids.model]: "A6" }, y: [2008, 2011] },
        { v: { [ids.make]: "BMW", [ids.model]: "X3" }, y: [2015, 2015] },
      ]),
    );
    const audi2009 = await picks(
      `${ids.make}=AUDI&${ids.year}=2009&${ids.model}=A6`,
    );
    expect((await q.productFits(s, P(1), [], audi2009)).state).toBe("fits");
    expect((await q.productFits(s, P(2), [], audi2009)).state).toBe("no-fit");
    // collection link: fits every product in the collection
    const inBrakes = await q.productFits(
      s,
      P(4),
      ["gid://shopify/Collection/9"],
      audi2009,
    );
    expect(inBrakes.state).toBe("fits");
    expect(inBrakes.total).toBe(1);
    // universal: fits everything, no rows
    const uni = await q.productFits(s, P(3), [], audi2009);
    expect(uni).toMatchObject({ state: "fits", universal: true, total: 0 });
  });

  it("lists active products that fit, universal last, with collections", async () => {
    const s = await search();
    const r = await q.searchResults(
      s,
      await picks(`${ids.make}=AUDI&${ids.year}=2009&${ids.model}=A6`),
      1,
    );
    expect(r.products).toEqual([
      { handle: "product-1", universal: false },
      { handle: "product-3", universal: true },
    ]); // product-5 is a draft
    expect(r.collections).toEqual([{ handle: "brakes", title: "Brakes" }]);
    expect(r.total).toBe(2);
    const none = await q.searchResults(
      s,
      await picks(`${ids.make}=BMW&${ids.year}=2009&${ids.model}=X3`),
      1,
    );
    expect(none.products).toEqual([{ handle: "product-3", universal: true }]);
  });

  it("finds one SKU per fitting product for the theme search", async () => {
    // a product link (handle) uses the product's first SKU; products without SKUs are counted
    await catalog.upsertProducts(
      shopId,
      [
        {
          ...product(6, ""),
          variants: [{ variantId: "gid://shopify/ProductVariant/6", sku: "" }],
        },
      ],
      { replaceVariants: true },
    );
    await add(shopId, "AUDI", "2009", "A6", "/products/product-2");
    await add(shopId, "AUDI", "2009", "A6", "product-6");
    await relink(shopId);
    const s = await search();
    const found = await q.fitSkus(
      s,
      await picks(`${ids.make}=AUDI&${ids.year}=2009&${ids.model}=A6`),
      100,
    );
    expect(found).toEqual({
      skus: ["SKU-1", "SKU-2", "UNI"],
      products: 4,
      withoutSku: 1,
    });
    // the limit cuts the list, not the counts
    const one = await q.fitSkus(
      s,
      await picks(`${ids.make}=AUDI&${ids.year}=2009&${ids.model}=A6`),
      1,
    );
    expect(one.skus).toEqual(["SKU-1", "SKU-2"]);
    expect(one.products).toBe(4);
  });

  it("pages results", async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      product(100 + i, `P-${i}`),
    );
    await catalog.upsertProducts(shopId, many, { replaceVariants: true });
    for (let i = 0; i < 20; i++)
      await add(shopId, "OPEL", "2001", "Astra", `P-${i}`);
    await relink(shopId);
    const s = await search();
    const query = await picks(
      `${ids.make}=OPEL&${ids.year}=2001&${ids.model}=Astra`,
    );
    const p1 = await q.searchResults(s, query, 1);
    const p2 = await q.searchResults(s, query, 2);
    expect(p1.total).toBe(21); // 20 + the universal product
    expect(p1.pageCount).toBe(2);
    expect(p1.products).toHaveLength(q.RESULTS_PAGE_SIZE);
    expect(p2.products).toHaveLength(21 - q.RESULTS_PAGE_SIZE);
    expect(
      new Set([...p1.products, ...p2.products].map((p) => p.handle)).size,
    ).toBe(21);
  });

  it("keeps shops apart", async () => {
    const other = await search(OTHER);
    expect(await q.fieldOptions(other, 0, new Map())).toEqual(["AUDI", "SEAT"]);
    const otherPicks = parsePicks(
      new URLSearchParams(
        `${other.fields[0].id}=AUDI&${other.fields[1].id}=2009&${other.fields[2].id}=A6`,
      ),
      other.fields,
    )!;
    // no catalog, links or universal products in the other shop
    expect((await q.searchResults(other, otherPicks, 1)).products).toEqual([]);
    expect((await q.productFits(other, P(1), [], otherPicks)).state).toBe(
      "no-fit",
    );
    // this shop's field ids don't work as picks there
    expect(
      parsePicks(new URLSearchParams(`${ids.make}=AUDI`), other.fields)!.size,
    ).toBe(0);
  });

  it("loads the shop's search setup in field order", async () => {
    const fields = await prisma.searchField.findMany({
      where: { shopId },
      orderBy: { position: "asc" },
      select: { id: true, label: true, type: true, required: true },
    });
    expect(await q.shopSearch(DOMAIN)).toEqual({
      shopId,
      dataVersion: await version(),
      fields,
    });
    // A shop without fields still has a (blank) search; one not set up has none.
    await prisma.searchField.deleteMany({ where: { shopId: otherId } });
    expect((await q.shopSearch(OTHER))?.fields).toEqual([]);
    await prisma.searchConfig.delete({ where: { shopId: otherId } });
    expect(await q.shopSearch(OTHER)).toBeNull();
  });

  it("ignores uninstalled shops", async () => {
    await prisma.shop.update({
      where: { id: shopId },
      data: { uninstalledAt: new Date() },
    });
    expect(await q.shopSearch(DOMAIN)).toBeNull();
    expect(await q.shopSearch("nobody.myshopify.com")).toBeNull();
  });

  it("publishes the config to the app metafield only when it changed", async () => {
    const calls: { query: string; variables?: Record<string, unknown> }[] = [];
    const gql = async (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      calls.push({ query, variables: options?.variables });
      const data = query.includes("currentAppInstallation")
        ? { currentAppInstallation: { id: "gid://shopify/AppInstallation/1" } }
        : { metafieldsSet: { metafields: [{ id: "m" }], userErrors: [] } };
      return { json: async () => ({ data }) };
    };
    expect(await publishStorefrontConfig(gql, shopId)).toBe(true);
    const set = calls.find((c) => c.query.includes("metafieldsSet"))!;
    const input = (set.variables!.metafields as Record<string, string>[])[0];
    expect(input).toMatchObject({
      ownerId: "gid://shopify/AppInstallation/1",
      namespace: "fitfinder",
      key: "config",
      type: "json",
    });
    expect(
      JSON.parse(input.value).fields.map((f: { label: string }) => f.label),
    ).toEqual(["Make", "Year", "Model"]);
    calls.length = 0;
    expect(await publishStorefrontConfig(gql, shopId)).toBe(false);
    expect(calls).toHaveLength(0);
    await applyFieldIntent(shopId, {
      intent: "label",
      fieldId: ids.model,
      value: "Type",
    });
    expect(await publishStorefrontConfig(gql, shopId)).toBe(true);
    // Reinstall: a new app installation has no metafield, so the same config is written again.
    await prisma.shop.update({
      where: { id: shopId },
      data: { uninstalledAt: new Date() },
    });
    await upsertShopOnInstall(DOMAIN);
    expect(await publishStorefrontConfig(gql, shopId)).toBe(true);
    expect(await publishStorefrontConfig(gql, shopId)).toBe(false);
  });

  it("refuses to record a publish Shopify rejected", async () => {
    const gql = async (query: string) => ({
      json: async () => ({
        data: query.includes("currentAppInstallation")
          ? {
              currentAppInstallation: { id: "gid://shopify/AppInstallation/1" },
            }
          : {
              metafieldsSet: {
                metafields: [],
                userErrors: [{ message: "Value too large" }],
              },
            },
      }),
    });
    await expect(publishStorefrontConfig(gql, shopId)).rejects.toThrow(
      "Value too large",
    );
    const row = await prisma.storefrontSettings.findUnique({
      where: { shopId },
    });
    expect(row?.publishedHash ?? null).toBeNull();
  });
});
