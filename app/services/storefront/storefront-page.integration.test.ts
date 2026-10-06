// Storefront page (M8) against the real Postgres in DATABASE_URL: settings merged per key without
// lost updates, publishes serialized so the newest config is written last, the preview sample,
// and the theme status cache. Every case checks that another shop is untouched.
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const DOMAIN = "vitest-sf-page.myshopify.com";
const OTHER = "vitest-sf-page-b.myshopify.com";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env: rely on the environment
}

const { default: prisma } = await import("../../db.server");
const { upsertShopOnInstall } = await import("../../models/shop.server");
const { applyStoreType } = await import("../../models/search-config.server");
const { saveRow } = await import("../../models/fitment-row.server");
const { saveSettings, saveHeading } =
  await import("../../models/storefront-settings.server");
const {
  publishStorefrontConfig,
  publishWithOutcome,
  storefrontConfigPublished,
  loadStorefrontConfig,
} = await import("./sync.server");
const { previewSample } = await import("./preview.server");
const { readThemeStatus } = await import("./themes.server");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Admin GraphQL double for the metafield publish; records each written config. */
function metafieldApi(delayMs = 0) {
  const written: { button: string; heading: string }[] = [];
  const gql = async (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => {
    if (query.includes("currentAppInstallation")) {
      return {
        json: async () => ({
          data: {
            currentAppInstallation: { id: "gid://shopify/AppInstallation/1" },
          },
        }),
      };
    }
    await sleep(delayMs);
    const value = (options!.variables!.metafields as { value: string }[])[0]
      .value;
    const doc = JSON.parse(value);
    written.push({ button: doc.s.button, heading: doc.heading });
    return {
      json: async () => ({
        data: { metafieldsSet: { metafields: [{ id: "m" }], userErrors: [] } },
      }),
    };
  };
  return { gql, written };
}

describe.skipIf(!process.env.DATABASE_URL)("storefront page (Postgres)", () => {
  let shopId: string;
  let otherId: string;

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
    for (const id of [shopId, otherId]) {
      await applyStoreType(id, "automotive", { replace: false });
    }
  });

  const stored = async (id: string) =>
    ((await prisma.storefrontSettings.findUnique({ where: { shopId: id } }))
      ?.settings ?? {}) as Record<string, unknown>;

  it("merges settings per key, also when saved at the same time", async () => {
    await saveSettings(otherId, { button: "Other shop" });
    await Promise.all([
      saveSettings(shopId, { button: "Go" }),
      saveSettings(shopId, { layout: "card" }),
      saveSettings(shopId, { labels: true }),
      saveSettings(shopId, { btn: "#000000" }),
      saveSettings(shopId, { tableHide: { x: true } }),
    ]);
    await saveSettings(shopId, { tableHide: {} });
    expect(await stored(shopId)).toEqual({
      button: "Go",
      layout: "card",
      labels: true,
      btn: "#000000",
      tableHide: {},
    });
    expect(await stored(otherId)).toEqual({ button: "Other shop" });
    const config = await loadStorefrontConfig(shopId);
    expect(config!.s).toMatchObject({
      button: "Go",
      layout: "card",
      labels: true,
    });
  });

  it("saves the heading for one shop", async () => {
    await saveHeading(shopId, "Find your parts");
    expect((await loadStorefrontConfig(shopId))!.heading).toBe(
      "Find your parts",
    );
    expect((await loadStorefrontConfig(otherId))!.heading).toBe(
      "Find parts for your vehicle",
    );
  });

  it("writes the newest config last when publishes overlap", async () => {
    const { gql, written } = metafieldApi(300);
    await saveSettings(shopId, { button: "First" });
    const first = publishStorefrontConfig(gql, shopId);
    await sleep(100); // the first publish holds the lock and waits on Shopify
    await saveSettings(shopId, { button: "Second" });
    const second = publishStorefrontConfig(gql, shopId);
    await Promise.all([first, second]);
    expect(written.map((w) => w.button)).toEqual(["First", "Second"]);
    expect(await storefrontConfigPublished(shopId)).toBe(true);
    // Nothing new: no write, no lock.
    expect(await publishStorefrontConfig(gql, shopId)).toBe(false);
    expect(written).toHaveLength(2);
  });

  it("returns at once when another publish holds the lease", async () => {
    const { gql, written } = metafieldApi();
    await saveSettings(shopId, { button: "Waiting" });
    await prisma.storefrontSettings.update({
      where: { shopId },
      data: { publishingUntil: new Date(Date.now() + 60_000) },
    });
    expect(await publishStorefrontConfig(gql, shopId)).toBe(false);
    expect(written).toHaveLength(0);
    // An expired lease (a crashed process) doesn't block.
    await prisma.storefrontSettings.update({
      where: { shopId },
      data: { publishingUntil: new Date(Date.now() - 1000) },
    });
    expect(await publishStorefrontConfig(gql, shopId)).toBe(true);
    const row = await prisma.storefrontSettings.findUnique({
      where: { shopId },
    });
    expect(row?.publishingUntil).toBeNull();
  });

  it("publishes again after a reinstall, even after a save that changed nothing", async () => {
    const { gql, written } = metafieldApi();
    await publishStorefrontConfig(gql, shopId);
    await prisma.shop.update({
      where: { id: shopId },
      data: { uninstalledAt: new Date() },
    });
    await upsertShopOnInstall(DOMAIN);
    await saveSettings(shopId, { layout: "bar" }); // same as the default
    expect(await storefrontConfigPublished(shopId)).toBe(false);
    expect(await publishStorefrontConfig(gql, shopId)).toBe(true);
    expect(written).toHaveLength(2);
  });

  it("a holder that outlived its lease leaves no stale config marked published", async () => {
    const { gql, written } = metafieldApi();
    await saveSettings(shopId, { button: "Old" });
    // The slow holder: its lease runs out while Shopify answers, and another publish takes the
    // expired lease and writes the newer config before the slow write lands.
    let once = true;
    const slow = async (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      if (query.includes("metafieldsSet") && once) {
        once = false;
        await prisma.storefrontSettings.update({
          where: { shopId },
          data: { publishingUntil: new Date(Date.now() - 1000) },
        });
        await saveSettings(shopId, { button: "New" });
        expect(await publishStorefrontConfig(gql, shopId)).toBe(true);
      }
      return gql(query, options);
    };
    await publishStorefrontConfig(slow, shopId);
    expect(written.map((w) => w.button)).toEqual(["New", "Old", "New"]);
    expect(await storefrontConfigPublished(shopId)).toBe(true);
  });

  it("an expired holder doesn't release someone else's lease", async () => {
    const { gql } = metafieldApi();
    await saveSettings(shopId, { button: "X" });
    const until = new Date(Date.now() + 60_000);
    const stealer = async (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      if (query.includes("metafieldsSet")) {
        // Another publish now holds a fresh lease.
        await prisma.storefrontSettings.update({
          where: { shopId },
          data: { publishingUntil: until },
        });
      }
      return gql(query, options);
    };
    await publishStorefrontConfig(stealer, shopId);
    const row = await prisma.storefrontSettings.findUnique({
      where: { shopId },
    });
    expect(row?.publishingUntil?.getTime()).toBe(until.getTime());
    expect(row?.publishedHash).toBeNull();
    expect(await publishWithOutcome(gql, shopId)).toBe("pending");
  });

  it("knows when the theme is behind after a failed publish", async () => {
    const { gql } = metafieldApi();
    await publishStorefrontConfig(gql, shopId);
    expect(await storefrontConfigPublished(shopId)).toBe(true);
    await saveSettings(shopId, { button: "Changed" });
    expect(await storefrontConfigPublished(shopId)).toBe(false);
    const failing = async () => {
      throw new Error("network");
    };
    await expect(publishStorefrontConfig(failing, shopId)).rejects.toThrow();
    expect(await storefrontConfigPublished(shopId)).toBe(false);
    await publishStorefrontConfig(gql, shopId);
    expect(await storefrontConfigPublished(shopId)).toBe(true);
  });

  it("takes the preview sample from the shop's own rows", async () => {
    const f = await prisma.searchField.findMany({
      where: { shopId },
      orderBy: { position: "asc" },
    });
    const row = (make: string, years: string, model: string, sku: string) =>
      saveRow(shopId, null, {
        [f[0].id]: make,
        [f[1].id]: years,
        [f[2].id]: model,
        attachment: sku,
      });
    await row("AUDI", "2008-2011", "A6", "S1");
    await row("AUDI", "2008-2011", "A6", "S2"); // same selection
    await row("BMW", "2015-", "X3", "S3");
    const of = await prisma.searchField.findMany({
      where: { shopId: otherId },
    });
    await saveRow(otherId, null, {
      [of[0].id]: "SEAT",
      [of[1].id]: "2000",
      [of[2].id]: "Ibiza",
      attachment: "X",
    });
    const fields = f.map((x) => ({ id: x.id, type: x.type }));
    const sample = await previewSample(shopId, fields);
    expect(sample.rows).toHaveLength(3);
    expect(sample.rows[0]).toEqual({
      v: { [f[0].id]: "AUDI", [f[2].id]: "A6" },
      y: [2008, 2011],
    });
    expect(sample.selections).toEqual([
      { [f[0].id]: "AUDI", [f[1].id]: "2008", [f[2].id]: "A6" },
      { [f[0].id]: "BMW", [f[1].id]: "2015", [f[2].id]: "X3" },
    ]);
    expect(JSON.stringify(sample)).not.toContain("SEAT");
  });

  it("caches the theme status per shop and theme", async () => {
    const files = [
      {
        filename: "config/settings_data.json",
        body: {
          content: JSON.stringify({
            current: {
              blocks: {
                a: {
                  type: "shopify://apps/fitfinder/blocks/fitfinder-embed/uid",
                  disabled: false,
                },
              },
            },
          }),
        },
      },
    ];
    let page = 0;
    const gql = async () => ({
      json: async () => ({
        data: {
          theme: {
            files: {
              nodes: page++ === 0 ? files : [],
              pageInfo: { hasNextPage: page === 1, endCursor: "c1" },
            },
          },
        },
      }),
    });
    const status = await readThemeStatus(gql, shopId, "123");
    expect(status.embedOn).toBe(true);
    expect(page).toBe(2); // followed the next page
    const rows = await prisma.themeStatus.findMany({
      where: { shopId: { in: [shopId, otherId] } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ shopId, themeId: "123", embedOn: true });
  });
});
