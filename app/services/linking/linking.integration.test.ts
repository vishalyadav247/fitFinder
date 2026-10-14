// Linking against the real Postgres in DATABASE_URL (M6 "Done when"): auto-linking by SKU only,
// first match wins, manual links kept, webhooks, the Product mapping lists, link check runs with
// a fake Admin API, and shop isolation.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const DOMAIN = "vitest-linking.myshopify.com";
const OTHER = "vitest-linking-b.myshopify.com";

const { default: prisma } = await import("../../db.server");
const { upsertShopOnInstall } = await import("../../models/shop.server");
const { applyStoreType } = await import("../../models/search-config.server");
const { rowCounts } = await import("../../models/fitment-row.server");
const mapping = await import("../../models/product-link.server");
const catalog = await import("./catalog.server");
const { relink, relinkProduct, removeProduct, withLinkLock } =
  await import("./relink.server");
const runs = await import("./link-runs.server");

try {
  process.loadEnvFile(".env");
} catch {
  // no .env: rely on the environment
}

type Product = Parameters<typeof catalog.upsertProducts>[1][number];
const P = (n: number) => `gid://shopify/Product/${n}`;
const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const product = (
  n: number,
  skus: string[],
  { handle = `product-${n}`, status = "ACTIVE", title = `Product ${n}` } = {},
): Product => ({
  productId: P(n),
  title,
  handle,
  status,
  variants: skus.map((sku, i) => ({ variantId: V(n * 100 + i), sku })),
});

/** A full sync whose export started now: everything in the cache is older and replaced. */
const loadCatalog = async (shop: string, products: Product[]) =>
  catalog.replaceCatalog(shop, products, await catalog.dbNow());

describe.skipIf(!process.env.DATABASE_URL)("linking (Postgres)", () => {
  let shopId: string;
  let otherShopId: string;
  let make: string;
  let seq = 0;

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
    otherShopId = (await upsertShopOnInstall(OTHER)).id;
    // Universal products are a Growth feature (seeded plans).
    await prisma.shop.updateMany({
      where: { id: { in: [shopId, otherShopId] } },
      data: { plan: "growth" },
    });
    await applyStoreType(shopId, "automotive", { replace: false });
    await applyStoreType(otherShopId, "automotive", { replace: false });
    make = (await prisma.searchField.findFirstOrThrow({
      where: { shopId },
      orderBy: { position: "asc" },
    }))!.id;
  });

  /** Filter rows: one per (make, attachment) pair. */
  const rows = (shop: string, list: [string, string][]) =>
    prisma.fitmentRow.createMany({
      data: list.map(([m, attachment]) => ({
        shopId: shop,
        values: { [make]: m },
        attachment,
        rowHash: `h${++seq}`,
      })),
    });

  /** A link made by hand before Choose product replaced SKUs (2026-10-09). */
  const manualLink = (attachment: string, productId: string) =>
    prisma.productLink.create({
      data: { shopId, attachment, productId, method: "manual" },
    });

  const links = async (shop = shopId) =>
    Object.fromEntries(
      (
        await prisma.productLink.findMany({
          where: { shopId: shop },
          orderBy: { attachment: "asc" },
        })
      ).map((l) => [
        l.attachment,
        `${l.productId}${l.variantId ? `:${l.variantId}` : ""}:${l.method}`,
      ]),
    );

  it("links SKUs only (case and spaces ignored)", async () => {
    await loadCatalog(shopId, [
      product(1, ["BRK-1", "brk-2"]),
      product(2, [], { handle: "disc" }),
    ]);
    const TAB = String.fromCharCode(9);
    const NBSP = String.fromCharCode(160);
    await rows(shopId, [
      ["Audi", " brk-1 "],
      ["BMW", "BRK-2"],
      ["Seat", `${TAB}brk-2${NBSP}`],
      // Links and handles aren't attachments: they match nothing.
      ["Audi", "https://shop.example/products/disc"],
      ["Audi", "/collections/audi-a4"],
      ["Audi", "disc"],
      ["Audi", "NOPE"],
    ]);
    expect(await relink(shopId)).toBe(3);
    expect(await links()).toEqual({
      " brk-1 ": `${P(1)}:${V(100)}:auto`,
      "BRK-2": `${P(1)}:${V(101)}:auto`,
      [`${TAB}brk-2${NBSP}`]: `${P(1)}:${V(101)}:auto`,
    });
    // Nothing new the second time.
    expect(await relink(shopId)).toBe(0);
    expect(await rowCounts(shopId)).toMatchObject({
      unlinkedRows: 4,
      unlinkedSkus: 4,
    });
  });

  it("first match wins on duplicate SKUs: active products first, then the oldest", async () => {
    await loadCatalog(shopId, [
      product(3, ["DUP"], { status: "DRAFT" }),
      product(9, ["DUP"]),
      product(12, ["DUP"]),
    ]);
    await rows(shopId, [["Audi", "DUP"]]);
    await relink(shopId);
    expect(await links()).toEqual({ DUP: `${P(9)}:${V(900)}:auto` });
  });

  it("keeps manual links, follows SKU changes and deletes (webhooks)", async () => {
    await loadCatalog(shopId, [
      product(1, ["A"]),
      product(2, ["B"]),
      product(4, ["A"]),
    ]);
    await rows(shopId, [
      ["Audi", "A"],
      ["Audi", "B"],
      ["Audi", "X"],
    ]);
    await relink(shopId);
    await manualLink("X", P(2));
    // A manual link is never changed by matching, even when the SKU starts to match.
    await catalog.upsertProducts(shopId, [product(1, ["A", "X"])], {
      replaceVariants: true,
    });
    await relinkProduct(shopId, product(1, ["A", "X"]));
    expect((await links()).X).toBe(`${P(2)}:manual`);

    // SKU B changes on product 2: its row is unlinked again.
    await catalog.upsertProducts(shopId, [product(2, ["B2"])], {
      replaceVariants: true,
    });
    await relinkProduct(shopId, product(2, ["B2"]));
    expect((await links()).B).toBeUndefined();

    // Product 1 deleted: A falls back to product 4 (same SKU); the manual link to 2 stays.
    await removeProduct(shopId, P(1));
    expect(await links()).toEqual({
      A: `${P(4)}:${V(400)}:auto`,
      X: `${P(2)}:manual`,
    });
    // Product 2 deleted: its manual link goes too.
    await removeProduct(shopId, P(2));
    expect((await links()).X).toBeUndefined();
  });

  it("drops links and universal products whose product is gone after a full sync", async () => {
    await loadCatalog(shopId, [product(1, ["A"]), product(2, [])]);
    await rows(shopId, [
      ["Audi", "A"],
      ["Audi", "M"],
    ]);
    await relink(shopId);
    await manualLink("M", P(2));
    await mapping.addUniversal(shopId, [P(2)]);
    await loadCatalog(shopId, [product(1, ["A"])]);
    await relink(shopId, { pruneMissing: true });
    expect(await links()).toEqual({ A: `${P(1)}:${V(100)}:auto` });
    expect(await prisma.universalProduct.count({ where: { shopId } })).toBe(0);
  });

  it("never links across shops", async () => {
    await loadCatalog(otherShopId, [product(1, ["A"])]);
    await rows(shopId, [["Audi", "A"]]);
    await rows(otherShopId, [["Audi", "A"]]);
    await relink(shopId);
    expect(await links()).toEqual({});
    await relink(otherShopId);
    expect(await links(otherShopId)).toEqual({
      A: `${P(1)}:${V(100)}:auto`,
    });
    await expect(mapping.addUniversal(shopId, [P(1)])).resolves.toBe(0);
  });

  it("Choose product: rows take the store SKU, copies are dropped, the old link goes", async () => {
    await loadCatalog(shopId, [product(1, ["NEW-1"]), product(2, ["OLD"])]);
    await rows(shopId, [
      ["Audi", "OLD-9"],
      ["BMW", "OLD-9"],
      ["Audi", "NEW-1"], // the Audi row exists with the new SKU already
    ]);
    await relink(shopId);
    await manualLink("OLD-9", P(2)); // a link made the old way
    const changed = await mapping.linkChosenProduct(shopId, "OLD-9", {
      productId: P(1),
      variantId: V(100),
      sku: "NEW-1",
    });
    expect(changed).toBe(1); // BMW; the Audi copy was dropped
    const all = await prisma.fitmentRow.findMany({
      where: { shopId },
      orderBy: { id: "asc" },
    });
    expect(
      all.map((r) => [
        (r.values as Record<string, string>)[make],
        r.attachment,
      ]),
    ).toEqual([
      ["BMW", "NEW-1"],
      ["Audi", "NEW-1"],
    ]);
    // The hash follows the new SKU: the row can't be added again.
    expect(new Set(all.map((r) => r.rowHash)).size).toBe(2);
    expect(await links()).toEqual({ "NEW-1": `${P(1)}:${V(100)}:auto` });
    // Matching keeps it, and the old SKU in a re-import comes back unlinked.
    await rows(shopId, [["Audi", "OLD-9"]]);
    await relink(shopId);
    expect(await links()).toEqual({ "NEW-1": `${P(1)}:${V(100)}:auto` });
    expect((await rowCounts(shopId)).unlinkedSkus).toBe(1);
    // Choosing the product whose SKU the rows already have just links them.
    await prisma.productLink.deleteMany({ where: { shopId } });
    expect(
      await mapping.linkChosenProduct(shopId, "NEW-1", {
        productId: P(1),
        variantId: V(100),
        sku: "NEW-1",
      }),
    ).toBe(2);
    expect((await links())["NEW-1"]).toBe(`${P(1)}:${V(100)}:auto`);
  });

  it("lists unlinked rows by attachment, products without data and universal products", async () => {
    await loadCatalog(shopId, [
      product(1, ["A"], { title: "Alpha" }),
      product(2, ["", "B"], { title: "Beta" }),
      product(3, [], { title: "Gamma" }),
      product(4, ["D"], { title: "Draft", status: "DRAFT" }),
    ]);
    await rows(shopId, [
      ["Audi", "A"],
      ["Audi", "Z"],
      ["BMW", "Z"],
      ["Seat", "Y"],
    ]);
    await relink(shopId);

    const unlinked = await mapping.unlinkedGroups(shopId, 1);
    expect(unlinked.items.map((g) => [g.attachment, g.rows])).toEqual([
      ["Z", 2],
      ["Y", 1],
    ]);
    expect(unlinked.items[0].first.values[make]).toBe("Audi");

    const without = await mapping.productsWithoutData(shopId, 1);
    expect(without.items.map((p) => [p.title, p.sku])).toEqual([
      ["Beta", "B"],
      ["Gamma", ""],
    ]);
    expect(without.total).toBe(2);
    expect(without.hasNextPage).toBe(false);

    // Paged: one per page, the total on every page, also past the last one.
    const firstOfTwo = await mapping.productsWithoutData(shopId, 1, 1);
    expect(firstOfTwo.items.map((p) => [p.title, p.sku])).toEqual([
      ["Beta", "B"],
    ]);
    expect([firstOfTwo.total, firstOfTwo.hasNextPage]).toEqual([2, true]);
    const secondOfTwo = await mapping.productsWithoutData(shopId, 2, 1);
    expect(secondOfTwo.items.map((p) => [p.title, p.sku])).toEqual([
      ["Gamma", ""],
    ]);
    expect([secondOfTwo.total, secondOfTwo.hasNextPage]).toEqual([2, false]);
    const pastLast = await mapping.productsWithoutData(shopId, 5, 1);
    expect([pastLast.items, pastLast.total]).toEqual([[], 2]);

    const unlinkedSecond = await mapping.unlinkedGroups(shopId, 2, 1);
    expect(
      unlinkedSecond.items.map((g) => [
        g.attachment,
        g.rows,
        g.first.values[make],
      ]),
    ).toEqual([["Y", 1, "Seat"]]);
    expect(unlinkedSecond.hasNextPage).toBe(false);
    expect((await mapping.unlinkedGroups(shopId, 3, 1)).items).toEqual([]);

    await mapping.addUniversal(shopId, [P(3)]);
    expect((await mapping.productsWithoutData(shopId, 1)).total).toBe(1);
    expect(
      (await mapping.universalProducts(shopId, 1)).items.map((p) => p.title),
    ).toEqual(["Gamma"]);
    await mapping.removeUniversal(shopId, P(3));
    expect((await mapping.universalProducts(shopId, 1)).total).toBe(0);

    // Choose product removes the group: every row with that attachment takes the product's SKU.
    await mapping.linkChosenProduct(shopId, "Z", {
      productId: P(3),
      variantId: V(300),
      sku: "G-1",
    });
    expect(
      (await mapping.unlinkedGroups(shopId, 1)).items.map((g) => g.attachment),
    ).toEqual(["Y"]);
    expect(
      (await mapping.productsWithoutData(shopId, 1)).items.map((p) => p.title),
    ).toEqual(["Beta"]);
    // The link outlives its rows, but the product has no filter data any more.
    await prisma.fitmentRow.deleteMany({
      where: { shopId, attachment: "G-1" },
    });
    expect(
      (await mapping.productsWithoutData(shopId, 1)).items.map((p) => p.title),
    ).toEqual(["Beta", "Gamma"]);
    await expect(
      mapping.linkChosenProduct(shopId, "gone", {
        productId: P(3),
        variantId: V(300),
        sku: "G-1",
      }),
    ).rejects.toThrow(mapping.LinkRuleError);
  });

  describe("link check runs", () => {
    const jsonl = [
      { id: P(1), title: "Pads", handle: "pads", status: "ACTIVE" },
      { id: V(100), sku: "A", __parentId: P(1) },
    ]
      .map((l) => JSON.stringify(l))
      .join("\n");

    const fakeAdmin = () => {
      const bodies: Record<string, unknown> = {
        CatalogBulkExport: {
          data: {
            bulkOperationRunQuery: {
              bulkOperation: { id: "gid://shopify/BulkOperation/1" },
              userErrors: [],
            },
          },
        },
        BulkStatus: {
          data: {
            bulkOperation: {
              status: "COMPLETED",
              errorCode: null,
              url: "https://storage.example/bulk.jsonl",
            },
          },
        },
      };
      const gql = async (query: string) => {
        const name = Object.keys(bodies).find((k) => query.includes(k))!;
        return { json: async () => bodies[name] };
      };
      return async () => gql;
    };

    it("loads the catalog, links, and records the result once", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(jsonl)),
      );
      try {
        await rows(shopId, [
          ["Audi", "A"],
          ["Audi", "/collections/audi"],
          ["Audi", "pads"],
        ]);
        expect((await runs.linkCheckState(shopId)).status).toBe("idle");
        const attempt = await runs.prepareLinkCheck(shopId, {
          fullSync: false,
        });
        expect(attempt).toBe(1);
        // A second request while queued doesn't queue another run.
        expect(
          await runs.prepareLinkCheck(shopId, { fullSync: true }),
        ).toBeNull();
        // A stale message (wrong attempt) does nothing.
        await runs.runLinkCheck(shopId, 99, fakeAdmin());
        expect((await runs.linkCheckState(shopId)).status).toBe("queued");

        await runs.runLinkCheck(shopId, attempt!, fakeAdmin());
        const state = await runs.linkCheckState(shopId);
        expect(state).toMatchObject({
          status: "completed",
          newMatches: 1,
          catalogReady: true,
        });
        // Only the SKU links: not the collection link, nor the product's handle.
        expect(await links()).toEqual({ A: `${P(1)}:${V(100)}:auto` });
        // Running the same attempt again (redelivery) is a no-op.
        await runs.runLinkCheck(shopId, attempt!, fakeAdmin());
        expect((await runs.linkCheckState(shopId)).newMatches).toBe(1);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("remembers a check asked for while one runs", async () => {
      const attempt = await runs.prepareLinkCheck(shopId, { fullSync: false });
      await prisma.catalogSync.update({
        where: { shopId },
        data: { status: "running" },
      });
      expect(
        await runs.prepareLinkCheck(shopId, { fullSync: true }),
      ).toBeNull();
      // Nothing to take while it still runs.
      expect(await runs.takePendingRun(shopId)).toBeNull();
      await prisma.catalogSync.update({
        where: { shopId },
        data: { status: "completed" },
      });
      expect(await runs.takePendingRun(shopId)).toBe(true);
      expect(await runs.takePendingRun(shopId)).toBeNull();
      expect(await runs.prepareLinkCheck(shopId, { fullSync: true })).toBe(
        attempt! + 1,
      );
    });

    it("syncs one product from Shopify: changed, then deleted", async () => {
      await loadCatalog(shopId, [product(1, ["A"])]);
      await rows(shopId, [
        ["Audi", "A"],
        ["Audi", "B"],
      ]);
      await relink(shopId);
      let current: unknown = {
        id: P(1),
        title: "Pads",
        handle: "pads",
        status: "ACTIVE",
        variants: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [{ id: V(100), sku: "B" }],
        },
      };
      const gqlFor = async () => async () => ({
        json: async () => ({ data: { product: current } }),
      });
      await runs.syncProduct(shopId, P(1), gqlFor);
      expect(await links()).toEqual({ B: `${P(1)}:${V(100)}:auto` });
      current = null;
      await runs.syncProduct(shopId, P(1), gqlFor);
      expect(await links()).toEqual({});
      // A delete marker stays, so an export that started earlier cannot bring it back.
      expect(
        await prisma.catalogProduct.findMany({
          where: { shopId },
          select: { status: true },
        }),
      ).toEqual([{ status: catalog.DELETED }]);
    });

    it("keeps webhook changes made while a full export ran", async () => {
      await loadCatalog(shopId, [product(1, ["A"]), product(2, ["B"])]);
      await rows(shopId, [
        ["Audi", "A"],
        ["Audi", "B"],
      ]);
      await relink(shopId);
      const exportStartedAt = await catalog.dbNow();
      // During the export: product 1 is deleted, product 2's SKU becomes B2.
      await removeProduct(shopId, P(1));
      await catalog.upsertProducts(shopId, [product(2, ["B2"])], {
        replaceVariants: true,
      });
      await relinkProduct(shopId, product(2, ["B2"]));
      // The export still has the old state of both.
      await catalog.replaceCatalog(
        shopId,
        [product(1, ["A"]), product(2, ["B"])],
        exportStartedAt,
      );
      await relink(shopId, { pruneMissing: true });
      expect(await links()).toEqual({});
    });

    it("tells the merchant to retry when a link check holds the lock", async () => {
      await loadCatalog(shopId, [product(1, ["A"])]);
      await rows(shopId, [["Audi", "X"]]);
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const isLocked = new Promise<void>((r) => (locked = r));
      const holder = withLinkLock(shopId, async () => {
        locked();
        await held;
      });
      await isLocked;
      try {
        await expect(
          mapping.linkChosenProduct(shopId, "X", {
            productId: P(1),
            variantId: V(100),
            sku: "A",
          }),
        ).rejects.toThrow("Links are being checked right now");
      } finally {
        release();
        await holder;
      }
    }, 20_000);

    it("leaves a pending rerun alone while a check is queued", async () => {
      await runs.prepareLinkCheck(shopId, { fullSync: false });
      await prisma.catalogSync.update({
        where: { shopId },
        data: { pendingFullSync: true },
      });
      expect(await runs.takePendingRun(shopId)).toBeNull();
      expect(
        (await prisma.catalogSync.findUniqueOrThrow({ where: { shopId } }))
          .pendingFullSync,
      ).toBe(true);
    });

    it("marks a failed Shopify call and a dead worker as failed", async () => {
      const attempt = await runs.prepareLinkCheck(shopId, { fullSync: true });
      await runs.runLinkCheck(shopId, attempt!, async () => {
        throw new Error("no session");
      });
      expect(await runs.linkCheckState(shopId)).toMatchObject({
        status: "failed",
        catalogReady: false,
      });

      const next = await runs.prepareLinkCheck(shopId, { fullSync: true });
      expect(next).toBe(attempt! + 1);
      await prisma.$executeRaw`
        UPDATE catalog_syncs SET status = 'running', updated_at = now() - interval '10 minutes'
        WHERE shop_id = ${shopId}`;
      expect((await runs.linkCheckState(shopId)).status).toBe("failed");
    });
  });
});
