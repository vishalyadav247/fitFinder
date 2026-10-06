// Plans (M9) against the real Postgres in DATABASE_URL: the plan read from the Partner API is
// stored and cached per shop, and the number limits are enforced on field adds, row adds,
// imports (rolled back), manual links and universal products. Another shop is never affected.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const DOMAIN = "vitest-billing.myshopify.com";
const OTHER = "vitest-billing-b.myshopify.com";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env: rely on the environment
}

const { default: prisma } = await import("../db.server");
const { upsertShopOnInstall } = await import("../models/shop.server");
const { applyStoreType } = await import("../models/search-config.server");
const { applyFieldIntent, FieldRuleError } =
  await import("../models/search-field.server");
const { saveRow, FitmentRuleError } =
  await import("../models/fitment-row.server");
const { linkManually, addUniversal, LinkRuleError } =
  await import("../models/product-link.server");
const catalog = await import("./linking/catalog.server");
const storageMod = await import("./storage.server");
const pipeline = await import("./import/pipeline.server");
const billing = await import("./billing.server");
const { coverage } = await import("./dashboard.server");

const config = { orgId: "1", token: "t", appGid: "gid://shopify/App/9" };
const gql = async () => ({
  json: async () => ({ data: { shop: { id: "gid://shopify/Shop/1" } } }),
});
const partner = (sub: unknown, calls: { n: number }) =>
  (async () => {
    calls.n++;
    return new Response(JSON.stringify({ data: { activeSubscription: sub } }));
  }) as unknown as typeof fetch;

describe.skipIf(!process.env.DATABASE_URL)(
  "plans and limits (Postgres)",
  () => {
    let shopId: string;
    let otherId: string;
    let dir: string;

    beforeAll(async () => {
      dir = await mkdtemp(path.join(os.tmpdir(), "ff-billing-"));
      storageMod.setStorageForTests(new storageMod.LocalStorage(dir));
    });
    afterAll(async () => {
      await prisma.shop.deleteMany({
        where: { domain: { in: [DOMAIN, OTHER] } },
      });
      storageMod.setStorageForTests(undefined);
      await rm(dir, { recursive: true, force: true });
    });
    beforeEach(async () => {
      billing.clearPlanCache();
      await prisma.shop.deleteMany({
        where: { domain: { in: [DOMAIN, OTHER] } },
      });
      shopId = (await upsertShopOnInstall(DOMAIN)).id;
      otherId = (await upsertShopOnInstall(OTHER)).id;
      for (const id of [shopId, otherId]) {
        await applyStoreType(id, "phones", { replace: false });
      }
    });

    const setPlan = (id: string, plan: string) =>
      prisma.shop.update({ where: { id }, data: { plan } });

    /** Fills a shop with n rows quickly (unique hashes; values don't matter here). */
    const fill = (id: string, n: number) => prisma.$executeRaw`
    INSERT INTO fitment_rows (shop_id, "values", attachment, row_hash, updated_at)
    SELECT ${id}, '{}'::jsonb, 'FILL-' || g, md5('fill' || g), now()
    FROM generate_series(1, ${n}) g`;

    describe("plan from the Partner API", () => {
      it("stores the plan and trial, and caches the read for 5 minutes", async () => {
        const calls = { n: 0 };
        const fetcher = partner(
          {
            billingPeriod: "EVERY_30_DAYS",
            trialEndsAt: "2026-10-20T00:00:00Z",
            items: [{ handle: "growth" }],
          },
          calls,
        );
        const now = Date.now();
        const first = await billing.shopPlan(gql, shopId, {
          config,
          fetcher,
          now,
        });
        expect(first).toMatchObject({
          plan: "growth",
          connected: true,
          fresh: true,
        });
        expect(first.trialEndsAt?.toISOString()).toBe(
          "2026-10-20T00:00:00.000Z",
        );
        const shop = await prisma.shop.findUniqueOrThrow({
          where: { id: shopId },
        });
        expect(shop.plan).toBe("growth");
        await billing.shopPlan(gql, shopId, {
          config,
          fetcher,
          now: now + 60_000,
        });
        expect(calls.n).toBe(1);
        await billing.shopPlan(gql, shopId, {
          config,
          fetcher,
          now: now + 6 * 60_000,
        });
        // A forced read right after a read is absorbed (at most one per 10 s)…
        await billing.shopPlan(gql, shopId, {
          config,
          fetcher,
          now: now + 6 * 60_000 + 5_000,
          force: true,
        });
        expect(calls.n).toBe(2);
        // …later it goes through.
        await billing.shopPlan(gql, shopId, {
          config,
          fetcher,
          now: now + 6 * 60_000 + 11_000,
          force: true,
        });
        expect(calls.n).toBe(3);
        expect(
          (await prisma.shop.findUniqueOrThrow({ where: { id: otherId } }))
            .plan,
        ).toBe("none");
      });

      it("marks a shop without a subscription and keeps the stored plan on failures", async () => {
        const calls = { n: 0 };
        expect(
          (
            await billing.shopPlan(gql, shopId, {
              config,
              fetcher: partner(null, calls),
            })
          ).plan,
        ).toBe("none");
        await setPlan(shopId, "pro");
        const failing = (async () =>
          new Response("{}", { status: 503 })) as unknown as typeof fetch;
        const state = await billing.shopPlan(gql, shopId, {
          config,
          fetcher: failing,
          force: true,
        });
        expect(state).toMatchObject({ plan: "pro", fresh: false });
      });

      it("shares one read between parallel loaders", async () => {
        const calls = { n: 0 };
        const fetcher = partner(
          {
            billingPeriod: null,
            trialEndsAt: null,
            items: [{ handle: "pro" }],
          },
          calls,
        );
        await Promise.all([
          billing.shopPlan(gql, shopId, { config, fetcher }),
          billing.shopPlan(gql, shopId, { config, fetcher }),
        ]);
        expect(calls.n).toBe(1);
      });

      it("works without billing credentials (stored plan, not connected)", async () => {
        // A new (or reinstalled) shop has no plan until the Partner API says so.
        expect(
          await billing.shopPlan(gql, shopId, { config: null }),
        ).toMatchObject({
          connected: false,
          plan: "none",
        });
      });

      it("waits a minute after a failed read, unless forced", async () => {
        const calls = { n: 0 };
        const failing = (async () => {
          calls.n++;
          return new Response("{}", { status: 429 });
        }) as unknown as typeof fetch;
        const now = Date.now();
        await billing.shopPlan(gql, shopId, { config, fetcher: failing, now });
        const again = await billing.shopPlan(gql, shopId, {
          config,
          fetcher: failing,
          now: now + 30_000,
        });
        expect(again.fresh).toBe(false);
        expect(calls.n).toBe(1);
        await billing.shopPlan(gql, shopId, {
          config,
          fetcher: failing,
          now: now + 30_000,
          force: true,
        });
        expect(calls.n).toBe(2);
        await billing.shopPlan(gql, shopId, {
          config,
          fetcher: failing,
          now: now + 120_000,
        });
        expect(calls.n).toBe(3);
      });

      it("doesn't let an older read overwrite a newer forced one", async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const slowNone = (async () => {
          await gate; // answers after the forced read
          return new Response(
            JSON.stringify({ data: { activeSubscription: null } }),
          );
        }) as unknown as typeof fetch;
        const growth = partner(
          {
            billingPeriod: null,
            trialEndsAt: null,
            items: [{ handle: "growth" }],
          },
          { n: 0 },
        );
        const old = billing.shopPlan(gql, shopId, {
          config,
          fetcher: slowNone,
        });
        const forced = await billing.shopPlan(gql, shopId, {
          config,
          fetcher: growth,
          force: true,
        });
        expect(forced.plan).toBe("growth");
        release();
        await old;
        const shop = await prisma.shop.findUniqueOrThrow({
          where: { id: shopId },
        });
        expect(shop.plan).toBe("growth");
      });

      it("keeps 'no subscription' for a minute only", async () => {
        const calls = { n: 0 };
        const none = partner(null, calls);
        const now = Date.now();
        await billing.shopPlan(gql, shopId, { config, fetcher: none, now });
        await billing.shopPlan(gql, shopId, {
          config,
          fetcher: none,
          now: now + 30_000,
        });
        expect(calls.n).toBe(1);
        await billing.shopPlan(gql, shopId, {
          config,
          fetcher: none,
          now: now + 90_000,
        });
        expect(calls.n).toBe(2);
      });
    });

    describe("limits", () => {
      it("doesn't limit search fields by plan (only the 20-field cap)", async () => {
        await setPlan(shopId, "none");
        // Phones preset: Brand, Series, Model (3 fields); Starter can go to 5 and on.
        await applyFieldIntent(shopId, { intent: "add" });
        await applyFieldIntent(shopId, { intent: "add" });
        expect(await prisma.searchField.count({ where: { shopId } })).toBe(5);
        for (let i = 5; i < 20; i++) {
          await applyFieldIntent(shopId, { intent: "add" });
        }
        await expect(
          applyFieldIntent(shopId, { intent: "add" }),
        ).rejects.toThrow(FieldRuleError);
      });

      it("refuses a row past the row limit", async () => {
        const f = await prisma.searchField.findMany({
          where: { shopId },
          orderBy: { position: "asc" },
        });
        const form = (sku: string) => ({
          [f[0].id]: "Apple",
          [f[1].id]: "iPhone",
          [f[2].id]: "15",
          attachment: sku,
        });
        await fill(shopId, 4999);
        await fill(otherId, 6000); // another shop's rows don't count
        expect((await saveRow(shopId, null, form("A"))).ok).toBe(true);
        await expect(saveRow(shopId, null, form("B"))).rejects.toThrow(
          FitmentRuleError,
        );
        await setPlan(shopId, "pro");
        expect((await saveRow(shopId, null, form("B"))).ok).toBe(true);
      });

      it("rolls back an import that would pass the row limit", async () => {
        await fill(shopId, 4999);
        const csv =
          "Brand,Series,Model,SKU\nApple,iPhone,15,S1\nApple,iPhone,16,S2\n";
        const key = storageMod.newUploadKey(shopId, "data.csv");
        await storageMod.storage().put(key, Buffer.from(csv));
        const { job, choices } = await pipeline.createImport(shopId, {
          key,
          fileName: "data.csv",
          mode: "upsert",
        });
        await pipeline.saveMapping(shopId, job.id, {
          choices,
          hasHeader: true,
          lookForSkus: true,
          mode: "upsert",
        });
        await pipeline.runPreview(job.id);
        await pipeline.startRun(shopId, job.id);
        await pipeline.runImport(job.id);
        const done = await prisma.importJob.findUniqueOrThrow({
          where: { id: job.id },
        });
        expect(done.status).toBe("failed");
        expect(done.failureReason).toContain(
          "Nothing was imported. The Starter plan allows up to 5,000 filter rows.",
        );
        expect(await prisma.fitmentRow.count({ where: { shopId } })).toBe(4999);
      });

      it("counts linked and universal products against the limit", async () => {
        const products = Array.from({ length: 52 }, (_, i) => ({
          productId: `gid://shopify/Product/${i + 1}`,
          title: `P${i + 1}`,
          handle: `p-${i + 1}`,
          status: "ACTIVE",
          variants: [],
        }));
        await catalog.replaceCatalog(
          shopId,
          products,
          [],
          await catalog.dbNow(),
        );
        const ids = products.map((p) => p.productId);
        expect(await addUniversal(shopId, ids.slice(0, 49))).toBe(49);
        await expect(addUniversal(shopId, ids.slice(49, 51))).rejects.toThrow(
          LinkRuleError,
        );
        // Re-adding known products doesn't count twice.
        expect(await addUniversal(shopId, ids.slice(0, 2))).toBe(0);

        const f = await prisma.searchField.findMany({
          where: { shopId },
          orderBy: { position: "asc" },
        });
        for (const sku of ["L1", "L2"]) {
          const saved = await saveRow(shopId, null, {
            [f[0].id]: "Apple",
            [f[1].id]: "iPhone",
            [f[2].id]: sku,
            attachment: sku,
          });
          expect(saved.ok).toBe(true);
        }
        const target = (n: number) => ({
          type: "product" as const,
          productId: ids[n],
          variantId: null,
        });
        await linkManually(shopId, "L1", target(49)); // the 50th product
        await expect(linkManually(shopId, "L2", target(50))).rejects.toThrow(
          LinkRuleError,
        );
        await linkManually(shopId, "L2", target(0)); // already universal: no new product
        await linkManually(shopId, "L1", target(50)); // replaces L1's own product: still 50
        expect(await billing.linkedProductCount(shopId)).toBe(50);
        expect(await billing.linkedProductCount(otherId)).toBe(0);

        // Over the limit (e.g. after a downgrade): changes that add no product still work.
        await prisma.shop.update({
          where: { id: shopId },
          data: { plan: "none" },
        });
        await prisma.universalProduct.create({
          data: { shopId, productId: ids[51] },
        }); // 51 now
        await linkManually(shopId, "L2", target(1)); // already counted
        expect(await addUniversal(shopId, [ids[50]])).toBe(1); // linked via L1 already
        await expect(addUniversal(shopId, [ids[51], ids[0]])).resolves.toBe(0);

        // A link whose rows are gone doesn't count (and can't be seen or removed).
        await prisma.fitmentRow.deleteMany({
          where: { shopId, attachment: "L1" },
        });
        expect(await billing.linkedProductCount(shopId)).toBe(51);
      });

      it("lets only one of two parallel universal adds pass the limit", async () => {
        const products = Array.from({ length: 52 }, (_, i) => ({
          productId: `gid://shopify/Product/${i + 1}`,
          title: `P${i + 1}`,
          handle: `p-${i + 1}`,
          status: "ACTIVE",
          variants: [],
        }));
        await catalog.replaceCatalog(
          shopId,
          products,
          [],
          await catalog.dbNow(),
        );
        const ids = products.map((p) => p.productId);
        await addUniversal(shopId, ids.slice(0, 49));
        const results = await Promise.allSettled([
          addUniversal(shopId, [ids[49]]),
          addUniversal(shopId, [ids[50]]),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(await billing.linkedProductCount(shopId)).toBe(50);
      });

      it("imports a file whose rows are mostly there already, near the limit", async () => {
        // 4,999 rows; the file has 2 rows: one already present, one new → 5,000 (fits).
        await fill(shopId, 4998);
        const f = await prisma.searchField.findMany({
          where: { shopId },
          orderBy: { position: "asc" },
        });
        expect(
          (
            await saveRow(shopId, null, {
              [f[0].id]: "Apple",
              [f[1].id]: "iPhone",
              [f[2].id]: "15",
              attachment: "S1",
            })
          ).ok,
        ).toBe(true);
        const csv =
          "Brand,Series,Model,SKU\nApple,iPhone,15,S1\nApple,iPhone,16,S2\n";
        const key = storageMod.newUploadKey(shopId, "near.csv");
        await storageMod.storage().put(key, Buffer.from(csv));
        const { job, choices } = await pipeline.createImport(shopId, {
          key,
          fileName: "near.csv",
          mode: "upsert",
        });
        await pipeline.saveMapping(shopId, job.id, {
          choices,
          hasHeader: true,
          lookForSkus: true,
          mode: "upsert",
        });
        await pipeline.runPreview(job.id);
        await pipeline.startRun(shopId, job.id);
        await pipeline.runImport(job.id);
        const done = await prisma.importJob.findUniqueOrThrow({
          where: { id: job.id },
        });
        expect(done.status).toBe("completed");
        expect(await prisma.fitmentRow.count({ where: { shopId } })).toBe(5000);
      });

      it("refuses a Replace import over the limit before deleting anything", async () => {
        await fill(shopId, 10);
        const lines = Array.from(
          { length: 5001 },
          (_, i) => `Apple,iPhone,${i},S${i}`,
        );
        const csv = ["Brand,Series,Model,SKU", ...lines].join("\n");
        const key = storageMod.newUploadKey(shopId, "big.csv");
        await storageMod.storage().put(key, Buffer.from(csv));
        const { job, choices } = await pipeline.createImport(shopId, {
          key,
          fileName: "big.csv",
          mode: "replace",
        });
        await pipeline.saveMapping(shopId, job.id, {
          choices,
          hasHeader: true,
          lookForSkus: true,
          mode: "replace",
        });
        await pipeline.runPreview(job.id);
        await pipeline.startRun(shopId, job.id);
        await pipeline.runImport(job.id);
        const done = await prisma.importJob.findUniqueOrThrow({
          where: { id: job.id },
        });
        expect(done.status).toBe("failed");
        expect(done.failureReason).toContain("Nothing was imported.");
        expect(await prisma.fitmentRow.count({ where: { shopId } })).toBe(10);
      });
    });

    it("counts distinct values per list field for the overview", async () => {
      const f = await prisma.searchField.findMany({
        where: { shopId },
        orderBy: { position: "asc" },
      });
      for (const [brand, series, model] of [
        ["Apple", "iPhone", "15"],
        ["Apple", "iPhone", "16"],
        ["Samsung", "Galaxy", "S24"],
      ]) {
        const saved = await saveRow(shopId, null, {
          [f[0].id]: brand,
          [f[1].id]: series,
          [f[2].id]: model,
          attachment: model,
        });
        expect(saved.ok).toBe(true);
      }
      const of = await prisma.searchField.findMany({
        where: { shopId: otherId },
        orderBy: { position: "asc" },
      });
      await saveRow(otherId, null, {
        [of[0].id]: "Nokia",
        [of[1].id]: "N",
        [of[2].id]: "3310",
        attachment: "N",
      });
      const fields = f.map((x) => ({
        id: x.id,
        label: x.label,
        type: "list" as const,
      }));
      expect(await coverage(shopId, fields)).toEqual([
        { label: "Brand", count: 2 },
        { label: "Series", count: 2 },
        { label: "Model", count: 3 },
      ]);
    });
  },
);
