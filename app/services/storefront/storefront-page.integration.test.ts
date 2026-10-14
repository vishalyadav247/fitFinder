// Storefront page (M8) against the real Postgres in DATABASE_URL: settings merged per key without
// lost updates, publishes serialized so the newest config is written last, the preview sample,
// and the theme status cache. Every case checks that another shop is untouched.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { FirstList } from "./config";

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
  publishForShop,
  publishFirstList,
  firstListBehind,
} = await import("./sync.server");
const { applyFieldSave } = await import("../../models/search-field.server");
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
                  type: "shopify://apps/sparefit/blocks/sparefit-embed/uid",
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
  // ---------------------------------------------------------------- first dropdown list

  /** Admin GraphQL double that keeps every metafield written, by key. */
  function captureApi() {
    const writes: { key: string; doc: Record<string, unknown> }[] = [];
    const gql = async (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      if (query.includes("currentAppInstallation")) {
        return {
          json: async () => ({
            data: {
              currentAppInstallation: {
                id: "gid://shopify/AppInstallation/1",
              },
            },
          }),
        };
      }
      const [mf] = options!.variables!.metafields as {
        key: string;
        value: string;
      }[];
      writes.push({ key: mf.key, doc: JSON.parse(mf.value) });
      return {
        json: async () => ({
          data: {
            metafieldsSet: { metafields: [{ id: "m" }], userErrors: [] },
          },
        }),
      };
    };
    const firsts = () => writes.filter((w) => w.key === "first");
    return {
      gql,
      writes,
      firsts,
      last: () => firsts()[firsts().length - 1]?.doc as unknown as FirstList,
    };
  }

  const fieldsOf = (id: string) =>
    prisma.searchField.findMany({
      where: { shopId: id },
      orderBy: { position: "asc" },
    });

  async function addRow(id: string, make: string, years: string) {
    const [m, y, model] = await fieldsOf(id);
    const saved = await saveRow(id, null, {
      [m.id]: make,
      [y.id]: years,
      [model.id]: "Any",
      attachment: `SKU-${make}`,
    });
    expect(saved.ok).toBe(true);
  }

  it("publishes the first dropdown list to its own metafield, per shop", async () => {
    await addRow(shopId, "BMW", "2015-2016");
    await addRow(shopId, "AUDI", "2008-2011");
    await addRow(otherId, "SEAT", "2000-2001");
    const make = (await fieldsOf(shopId))[0];

    const api = captureApi();
    expect(await publishFirstList(api.gql, shopId)).toBe(true);
    expect(api.writes.map((w) => w.key)).toEqual(["first"]); // config untouched
    expect(api.last()).toEqual({ f: make.id, v: ["AUDI", "BMW"] });
    // The shared config doesn't carry the list (it is printed on every page).
    expect("first" in (await loadStorefrontConfig(shopId))!).toBe(false);

    const other = captureApi();
    await publishFirstList(other.gql, otherId);
    expect(other.last().v).toEqual(["SEAT"]);
  });

  it("publishes an empty list before any rows", async () => {
    const api = captureApi();
    await publishFirstList(api.gql, shopId);
    expect(api.last().v).toEqual([]);
  });

  it("new rows and a new order make it behind; the job catches up; nothing changed means no write", async () => {
    await addRow(shopId, "AUDI", "2008-2009");
    const api = captureApi();
    expect(await firstListBehind(shopId)).toBe(true);
    await publishFirstList(api.gql, shopId);
    expect(await firstListBehind(shopId)).toBe(false);
    expect(await publishFirstList(api.gql, shopId)).toBe(false);
    expect(api.firsts()).toHaveLength(1);

    await addRow(shopId, "CUPRA", "2020-");
    expect(await firstListBehind(shopId)).toBe(true);
    await publishFirstList(api.gql, shopId);
    expect(api.last().v).toEqual(["AUDI", "CUPRA"]);

    // Year moves to the top: the list belongs to Year, matching the config's new first field.
    const [make, year, model] = await fieldsOf(shopId);
    await applyFieldSave(shopId, [
      { intent: "order", fieldIds: [year.id, make.id, model.id] },
    ]);
    expect(await firstListBehind(shopId)).toBe(true);
    await publishFirstList(api.gql, shopId);
    const list = api.last();
    expect(list.f).toBe(year.id);
    expect(list.f).toBe((await loadStorefrontConfig(shopId))!.fields[0].id);
    const now = new Date().getUTCFullYear();
    expect(list.v).toEqual(
      expect.arrayContaining(["2008", "2009", "2020", String(now)]),
    );
    expect(list.v).not.toContain("AUDI");
    // A new year adds a year to open ranges ("2020-"): the list is due again on 1 January.
    expect(await firstListBehind(shopId)).toBe(false);
    expect(await firstListBehind(shopId, now + 1)).toBe(true);
  });

  it("publishes no list when it would be too large for every page", async () => {
    const [make] = await fieldsOf(shopId);
    // 1,000 long makes (about 45 KB): more than a search block should print.
    await prisma.$executeRaw`
      INSERT INTO fitment_rows (shop_id, "values", attachment, row_hash, updated_at)
      SELECT ${shopId}, jsonb_build_object(${make.id}::text, 'MAKE ' || lpad(i::text, 40, '0')),
             'SKU', md5('big' || i), now()
      FROM generate_series(1, 1000) i`;
    await prisma.searchConfig.update({
      where: { shopId },
      data: { dataVersion: { increment: 1 } },
    });
    const api = captureApi();
    await publishFirstList(api.gql, shopId);
    expect(api.last()).toEqual({ f: make.id, v: null }); // the widget asks the proxy
    expect(await firstListBehind(shopId)).toBe(false); // not retried until the next change
  });

  it("a failing values query publishes no list and never blocks the config", async () => {
    await addRow(shopId, "AUDI", "2008-2009");
    const errors: unknown[] = [];
    const log = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      const api = captureApi();
      await publishFirstList(api.gql, shopId, async () => {
        throw new Error("canceling statement due to statement timeout");
      });
      expect(api.last()).toMatchObject({ v: null });
      expect(errors).toHaveLength(1);
      expect(await firstListBehind(shopId)).toBe(false);
      // The config (fields, settings) publishes on its own path, without the values query.
      expect(await publishStorefrontConfig(api.gql, shopId)).toBe(true);
    } finally {
      console.error = log;
    }
  });

  it("orders tied positions the same way in the config and the list", async () => {
    await addRow(shopId, "AUDI", "2008-2009");
    // A tie can't come from the app (positions are renumbered): make one by hand.
    await prisma.searchField.updateMany({
      where: { shopId },
      data: { position: 0 },
    });
    await prisma.searchConfig.update({
      where: { shopId },
      data: { dataVersion: { increment: 1 } },
    });
    const api = captureApi();
    await publishFirstList(api.gql, shopId);
    expect(api.last().f).toBe(
      (await loadStorefrontConfig(shopId))!.fields[0].id,
    );
  });

  it("the background job publishes config and list for installed shops only", async () => {
    const api = captureApi();
    const asked: string[] = [];
    const gqlFor = async (domain: string) => {
      asked.push(domain);
      return api.gql as never;
    };
    expect(await publishForShop(shopId, gqlFor)).toBe(true);
    expect(asked).toEqual([DOMAIN]);
    expect(api.writes.map((w) => w.key).sort()).toEqual(["config", "first"]);

    await prisma.shop.update({
      where: { id: otherId },
      data: { uninstalledAt: new Date() },
    });
    expect(await publishForShop(otherId, gqlFor)).toBe(false);
    expect(await firstListBehind(otherId)).toBe(false);
    expect(asked).toEqual([DOMAIN]);
  });
});
