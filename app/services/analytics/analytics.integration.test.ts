// Storefront analytics against the real Postgres in DATABASE_URL: recording searches and fit
// checks (made-up selections and products are not counted), the page's report per period with
// the comparison, values per field, shop isolation and the 180-day purge.
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const DOMAIN = "vitest-analytics.myshopify.com";
const OTHER = "vitest-analytics-b.myshopify.com";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env: rely on the environment
}

const { default: prisma } = await import("../../db.server");
const { upsertShopOnInstall } = await import("../../models/shop.server");
const { applyStoreType } = await import("../../models/search-config.server");
const { saveRow } = await import("../../models/fitment-row.server");
const catalog = await import("../linking/catalog.server");
const { relink } = await import("../linking/relink.server");
const q = await import("../storefront/query.server");
const { parsePicks } = await import("../storefront/picks");
const { recordSearch, recordFitCheck } = await import("./record.server");
const report = await import("../../models/analytics.server");

const P = (n: number) => `gid://shopify/Product/${n}`;

describe.skipIf(!process.env.DATABASE_URL)("analytics (Postgres)", () => {
  let shopId: string;
  let otherId: string;
  let ids: { make: string; year: string; model: string };

  const search = async (domain = DOMAIN) => (await q.shopSearch(domain))!;
  const picks = async (make: string, year: string, model: string) =>
    parsePicks(
      new URLSearchParams({
        [ids.make]: make,
        [ids.year]: year,
        [ids.model]: model,
      }),
      (await search()).fields,
    )!;
  /** One "Show parts" click, as the /search route records it. */
  const click = async (make: string, year: string, model: string) => {
    const s = await search();
    const p = await picks(make, year, model);
    const found = await q.fitSkus(s, p, 100);
    return recordSearch(s, p, found.specific);
  };
  /** Moves every count of the shop `days` back. */
  const age = (days: number) =>
    prisma.$executeRaw`UPDATE search_stats SET day = day - ${days}::int WHERE shop_id = ${shopId}`;

  afterAll(async () => {
    await prisma.shop.deleteMany({
      where: { domain: { in: [DOMAIN, OTHER] } },
    });
  });

  beforeEach(async () => {
    await prisma.shop.deleteMany({
      where: { domain: { in: [DOMAIN, OTHER] } },
    });
    shopId = (await upsertShopOnInstall(DOMAIN)).id;
    otherId = (await upsertShopOnInstall(OTHER)).id;
    await applyStoreType(shopId, "automotive", { replace: false });
    await applyStoreType(otherId, "automotive", { replace: false });
    const f = await prisma.searchField.findMany({
      where: { shopId },
      orderBy: { position: "asc" },
    });
    ids = { make: f[0].id, year: f[1].id, model: f[2].id };
    await catalog.replaceCatalog(
      shopId,
      [1, 2].map((n) => ({
        productId: P(n),
        title: `Product ${n}`,
        handle: `product-${n}`,
        status: "ACTIVE",
        variants: [
          { variantId: `gid://shopify/ProductVariant/${n}`, sku: `SKU-${n}` },
        ],
      })),
      await catalog.dbNow(),
    );
    const row = (make: string, years: string, model: string, sku: string) =>
      saveRow(shopId, null, {
        [ids.make]: make,
        [ids.year]: years,
        [ids.model]: model,
        attachment: sku,
      });
    await row("AUDI", "2010-2015", "A4", "SKU-1");
    await row("BMW", "2012", "X3", "UNKNOWN-9"); // rows, but no product
    await relink(shopId);
    // A universal product doesn't make a search "found".
    await prisma.universalProduct.create({ data: { shopId, productId: P(2) } });
  });

  it("counts searches per selection and day, and which found nothing", async () => {
    expect(await click("AUDI", "2012", "A4")).toBe(true);
    expect(await click("AUDI", "2012", "A4")).toBe(true);
    expect(await click("BMW", "2012", "X3")).toBe(true);
    // Made up (no filter row has it): not counted.
    expect(await click("FORD", "2012", "Focus")).toBe(false);

    const stats = await prisma.searchStat.findMany({
      where: { shopId },
      orderBy: { searches: "desc" },
    });
    expect(stats.map((s) => [s.searches, s.noResults])).toEqual([
      [2, 0],
      [1, 1],
    ]);
    expect(stats[0].picks).toEqual({
      [ids.make]: "AUDI",
      [ids.year]: "2012",
      [ids.model]: "A4",
    });

    const r = await report.analyticsReport(shopId, 7);
    expect(r).toMatchObject({
      hasData: true,
      searches: 3,
      previousSearches: 0,
      noResults: 1,
      selections: 2,
    });
    expect(r.daily).toHaveLength(7);
    expect(r.daily[6].searches).toBe(3);
    expect(r.topSelections.map((s) => s.searches)).toEqual([2, 1]);
    expect(r.nothingFound).toHaveLength(1);
    expect(r.nothingFound[0].picks[ids.make]).toBe("BMW");
    expect(r.nothingFound[0].lastNoResult).toBe(r.daily[6].day);

    expect(await report.fieldValues(shopId, 7, ids.make)).toEqual([
      { value: "AUDI", searches: 2 },
      { value: "BMW", searches: 1 },
    ]);
    // The other shop sees nothing.
    expect((await report.analyticsReport(otherId, 7)).hasData).toBe(false);
  });

  it("compares with the period before and leaves out older days", async () => {
    await click("AUDI", "2012", "A4");
    await age(10); // in the 30-day period, before the 7-day one
    await click("AUDI", "2012", "A4");
    await click("AUDI", "2013", "A4");

    const week = await report.analyticsReport(shopId, 7);
    expect(week).toMatchObject({ searches: 2, previousSearches: 1 });
    const month = await report.analyticsReport(shopId, 30);
    expect(month).toMatchObject({ searches: 3, previousSearches: 0 });
    expect(month.daily).toHaveLength(30);
    expect(month.daily.reduce((n, d) => n + d.searches, 0)).toBe(3);
  });

  it("counts fit checks of catalog products only", async () => {
    expect(await recordFitCheck(shopId, P(1), true)).toBe(true);
    expect(await recordFitCheck(shopId, P(1), false)).toBe(true);
    expect(await recordFitCheck(shopId, P(1), true)).toBe(true);
    expect(await recordFitCheck(shopId, P(99), true)).toBe(false);
    // Another shop's product id isn't this shop's.
    expect(await recordFitCheck(otherId, P(1), true)).toBe(false);

    const r = await report.analyticsReport(shopId, 7);
    expect(r).toMatchObject({ fits: 2, noFit: 1, searches: 0 });
    expect(r.products).toEqual([
      { productId: P(1), title: "Product 1", fits: 2, noFit: 1 },
    ]);
  });

  it("purges counts older than 180 days", async () => {
    await click("AUDI", "2012", "A4");
    await recordFitCheck(shopId, P(1), true);
    await age(report.KEEP_DAYS + 1);
    await click("AUDI", "2012", "A4");
    await prisma.$executeRaw`UPDATE fit_check_stats SET day = day - ${report.KEEP_DAYS + 1}::int WHERE shop_id = ${shopId}`;

    await report.purgeOldStats();
    expect(await prisma.searchStat.count({ where: { shopId } })).toBe(1);
    expect(await prisma.fitCheckStat.count({ where: { shopId } })).toBe(0);
  });
});
