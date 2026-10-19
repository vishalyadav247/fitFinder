// Plans against the real Postgres in DATABASE_URL: charges created through the Billing API (a
// fake Admin API) map back to plans, the plan is stored and cached per shop, and the number limits are enforced on field adds, row adds,
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
const { applyFieldIntent } = await import("../models/search-field.server");
const { saveRow, FitmentRuleError } =
  await import("../models/fitment-row.server");
const { linkChosenProduct, addUniversal, LinkRuleError } =
  await import("../models/product-link.server");
const catalog = await import("./linking/catalog.server");
const storageMod = await import("./storage.server");
const pipeline = await import("./import/pipeline.server");
const billing = await import("./billing.server");
const { coverage } = await import("./dashboard.server");

const plansMod = await import("../models/plan.server");
const subs = await import("./subscription.server");
const { TEST_PLANS, withPlan } = await import("../tests/plans-fixture");

/** A fake Admin API for the Billing API calls: active charges per test, created/cancelled log. */
function fakeAdmin() {
  const state = {
    active: [] as { id: string; status: string; createdAt: string }[],
    created: [] as Record<string, unknown>[],
    cancelled: [] as string[],
    reads: 0,
    fail: false,
  };
  let n = 0;
  const gql = async (
    query: string,
    opts?: { variables?: Record<string, unknown> },
  ) => {
    const v = opts?.variables ?? {};
    let data: unknown;
    if (state.fail) {
      return { json: async () => ({ errors: [{ message: "boom" }] }) };
    }
    if (query.includes("ActiveSubscriptions")) {
      state.reads++;
      data = { currentAppInstallation: { activeSubscriptions: state.active } };
    } else if (query.includes("ShopPlanKind")) {
      data = { shop: { plan: { partnerDevelopment: true } } };
    } else if (query.includes("SubscriptionCreate")) {
      state.created.push(v);
      const id = `gid://shopify/AppSubscription/${++n}-${Date.now()}`;
      data = {
        appSubscriptionCreate: {
          appSubscription: { id, status: "PENDING", trialDays: v.trialDays },
          confirmationUrl: `https://admin.shopify.com/confirm/${n}`,
          userErrors: [],
        },
      };
    } else if (query.includes("SubscriptionCancel")) {
      state.cancelled.push(String(v.id));
      state.active = state.active.filter((x) => x.id !== v.id);
      data = {
        appSubscriptionCancel: {
          appSubscription: { id: v.id, status: "CANCELLED" },
          userErrors: [],
        },
      };
    } else {
      throw new Error("unexpected query " + query.slice(0, 60));
    }
    return { json: async () => ({ data }) };
  };
  /** Shopify approves charge `id` (it becomes the active one). */
  const approve = (id: string) => {
    state.active = [
      { id, status: "ACTIVE", createdAt: new Date().toISOString() },
    ];
  };
  return {
    gql: gql as unknown as Parameters<typeof billing.shopPlan>[0],
    state,
    approve,
  };
}

describe.skipIf(!process.env.DATABASE_URL)(
  "plans and limits (Postgres)",
  () => {
    let shopId: string;
    let otherId: string;
    let dir: string;

    beforeAll(async () => {
      plansMod.setPlansForTests(TEST_PLANS);
      dir = await mkdtemp(path.join(os.tmpdir(), "sp-billing-"));
      storageMod.setStorageForTests(new storageMod.LocalStorage(dir));
    });
    afterAll(async () => {
      await prisma.shop.deleteMany({
        where: { domain: { in: [DOMAIN, OTHER] } },
      });
      storageMod.setStorageForTests(undefined);
      plansMod.setPlansForTests(undefined);
      await rm(dir, { recursive: true, force: true });
    });
    beforeEach(async () => {
      billing.clearPlanCache();
      plansMod.setPlansForTests(TEST_PLANS);
      await prisma.shop.deleteMany({
        where: { domain: { in: [DOMAIN, OTHER] } },
      });
      shopId = (await upsertShopOnInstall(DOMAIN)).id;
      otherId = (await upsertShopOnInstall(OTHER)).id;
      for (const id of [shopId, otherId]) {
        await applyStoreType(id, "phones", { replace: false });
      }
    });

    const starterWithUniversal = withPlan("starter", {
      toggles: { ...TEST_PLANS[0].toggles, universalProducts: true },
    });

    const setPlan = (id: string, plan: string) =>
      prisma.shop.update({ where: { id }, data: { plan } });

    /** Fills a shop with n rows quickly (unique hashes; values don't matter here). */
    const fill = (id: string, n: number) => prisma.$executeRaw`
    INSERT INTO fitment_rows (shop_id, "values", attachment, row_hash, updated_at)
    SELECT ${id}, '{}'::jsonb, 'FILL-' || g, md5('fill' || g), now()
    FROM generate_series(1, ${n}) g`;

    describe("plan from the Billing API", () => {
      const shopRef = () => ({ id: shopId, domain: DOMAIN });
      const daysUntil = (d: Date | null) =>
        d ? Math.round((d.getTime() - Date.now()) / 86_400_000) : 0;
      const record = async () =>
        (await prisma.appSubscription.findMany({ where: { shopId } }))[0];

      it("creates a charge with the plan's price and trial, then stores the approved plan", async () => {
        const admin = fakeAdmin();
        const { confirmationUrl, trialDays } = await subs.startSubscription(
          admin.gql,
          shopRef(),
          "growth",
          "monthly",
        );
        expect(confirmationUrl).toMatch(/^https:\/\/admin\.shopify\.com\//);
        expect(trialDays).toBe(14);
        expect(admin.state.created[0]).toMatchObject({
          trialDays: 14,
          test: true,
          // The handle comes from SHOPIFY_APP_HANDLE (.env: sparefit-dev locally, sparefit in production).
          returnUrl: `https://admin.shopify.com/store/vitest-billing/apps/${subs.appHandle()}/app/plans?charge=1`,
          lineItems: [
            {
              plan: {
                appRecurringPricingDetails: {
                  price: { amount: 29, currencyCode: "USD" },
                  interval: "EVERY_30_DAYS",
                },
              },
            },
          ],
        });
        // Not approved yet: no plan.
        expect(
          (await billing.shopPlan(admin.gql, shopId, { force: true })).plan,
        ).toBe("none");
        const pending = await record();
        expect(pending).toMatchObject({
          planKey: "growth",
          status: "PENDING",
          trialDays: 14,
        });

        admin.approve(pending.shopifyId);
        const state = await billing.shopPlan(admin.gql, shopId, {
          force: true,
          bypassThrottle: true,
        });
        expect(state.plan).toBe("growth");
        expect(daysUntil(state.trialEndsAt)).toBe(14);
        const shop = await prisma.shop.findUniqueOrThrow({
          where: { id: shopId },
        });
        expect(shop).toMatchObject({
          plan: "growth",
          subscriptionId: pending.shopifyId,
        });
        expect(
          (await prisma.shop.findUniqueOrThrow({ where: { id: otherId } }))
            .plan,
        ).toBe("none");
      });

      it("uses the backoffice's current price and trial for new charges", async () => {
        plansMod.setPlansForTests(
          withPlan("growth", {
            priceMonthly: 39,
            priceYearly: 390,
            trialDays: 7,
          }),
        );
        const admin = fakeAdmin();
        await subs.startSubscription(admin.gql, shopRef(), "growth", "yearly");
        expect(admin.state.created[0]).toMatchObject({
          trialDays: 7,
          lineItems: [
            {
              plan: {
                appRecurringPricingDetails: {
                  price: { amount: 390 },
                  interval: "ANNUAL",
                },
              },
            },
          ],
        });
      });

      it("refuses free, hidden and unknown plans and missing yearly prices", async () => {
        const admin = fakeAdmin();
        for (const key of ["starter", "business", "nope"]) {
          await expect(
            subs.startSubscription(admin.gql, shopRef(), key, "monthly"),
          ).rejects.toThrow(subs.BillingError);
        }
        plansMod.setPlansForTests(withPlan("growth", { priceYearly: null }));
        await expect(
          subs.startSubscription(admin.gql, shopRef(), "growth", "yearly"),
        ).rejects.toThrow(subs.BillingError);
        expect(admin.state.created).toHaveLength(0);
      });

      it("doesn't give a new trial for days already used", async () => {
        const admin = fakeAdmin();
        await subs.startSubscription(admin.gql, shopRef(), "growth", "monthly");
        const first = await record();
        // Approved 10 days ago, ended now.
        await prisma.appSubscription.update({
          where: { id: first.id },
          data: {
            status: "CANCELLED",
            activatedAt: new Date(Date.now() - 10 * 86_400_000),
            endedAt: new Date(),
          },
        });
        expect(await subs.trialDaysUsed(shopId)).toBe(10);
        const again = await subs.startSubscription(
          admin.gql,
          shopRef(),
          "pro",
          "monthly",
        );
        expect(again.trialDays).toBe(4);
        expect(await subs.trialDaysUsed(otherId)).toBe(0);
      });

      it("moves to the free plan: cancels the charge and keeps the free plan", async () => {
        const admin = fakeAdmin();
        await subs.startSubscription(admin.gql, shopRef(), "pro", "monthly");
        const charge = await record();
        admin.approve(charge.shopifyId);
        await billing.shopPlan(admin.gql, shopId, { force: true });
        await subs.switchToFree(admin.gql, shopId, "starter");
        expect(admin.state.cancelled).toEqual([charge.shopifyId]);
        const shop = await prisma.shop.findUniqueOrThrow({
          where: { id: shopId },
        });
        expect(shop).toMatchObject({ plan: "starter", subscriptionId: null });
        const ended = await prisma.appSubscription.findUniqueOrThrow({
          where: { id: charge.id },
        });
        expect(ended.endedAt).not.toBeNull();
        // A later read keeps the free plan (no active charge).
        expect(
          (
            await billing.shopPlan(admin.gql, shopId, {
              force: true,
              bypassThrottle: true,
            })
          ).plan,
        ).toBe("starter");
        await expect(
          subs.switchToFree(admin.gql, shopId, "growth"),
        ).rejects.toThrow(subs.BillingError);
      });

      it("drops a paid plan whose charge is no longer active", async () => {
        const admin = fakeAdmin();
        await subs.startSubscription(admin.gql, shopRef(), "growth", "monthly");
        const charge = await record();
        admin.approve(charge.shopifyId);
        await billing.shopPlan(admin.gql, shopId, { force: true });
        admin.state.active = [];
        expect(
          (
            await billing.shopPlan(admin.gql, shopId, {
              force: true,
              bypassThrottle: true,
            })
          ).plan,
        ).toBe("none");
        const ended = await prisma.appSubscription.findUniqueOrThrow({
          where: { id: charge.id },
        });
        expect(ended.endedAt).not.toBeNull();
      });

      it("adopts an active charge it has no record of, by its name", async () => {
        const admin = fakeAdmin();
        admin.state.active = [
          {
            id: "gid://shopify/AppSubscription/lost-1",
            name: "SpareFit Pro",
            status: "ACTIVE",
            createdAt: new Date().toISOString(),
            lineItems: [
              {
                plan: {
                  pricingDetails: {
                    __typename: "AppRecurringPricing",
                    interval: "EVERY_30_DAYS",
                    price: { amount: "99.0" },
                  },
                },
              },
            ],
          },
        ] as never;
        const state = await billing.shopPlan(admin.gql, shopId, {
          force: true,
        });
        expect(state.plan).toBe("pro");
        expect(await record()).toMatchObject({
          planKey: "pro",
          shopifyId: "gid://shopify/AppSubscription/lost-1",
        });
      });

      it("counts a started trial day as used", async () => {
        const admin = fakeAdmin();
        await subs.startSubscription(admin.gql, shopRef(), "growth", "monthly");
        const charge = await record();
        await prisma.appSubscription.update({
          where: { id: charge.id },
          data: {
            activatedAt: new Date(Date.now() - 2 * 3600_000),
            endedAt: new Date(),
          },
        });
        expect(await subs.trialDaysUsed(shopId)).toBe(1);
      });

      it("records webhook statuses", async () => {
        const admin = fakeAdmin();
        await subs.startSubscription(admin.gql, shopRef(), "growth", "monthly");
        const charge = await record();
        await subs.recordStatus(shopId, charge.shopifyId, "active");
        let row = await prisma.appSubscription.findUniqueOrThrow({
          where: { id: charge.id },
        });
        expect(row.status).toBe("ACTIVE");
        expect(row.activatedAt).not.toBeNull();
        await subs.recordStatus(shopId, charge.shopifyId, "CANCELLED");
        row = await prisma.appSubscription.findUniqueOrThrow({
          where: { id: charge.id },
        });
        expect(row.status).toBe("CANCELLED");
        expect(row.endedAt).not.toBeNull();
      });

      it("caches reads and keeps the stored plan on failures", async () => {
        const admin = fakeAdmin();
        const now = Date.now();
        await billing.shopPlan(admin.gql, shopId, { now });
        await billing.shopPlan(admin.gql, shopId, { now: now + 30_000 });
        expect(admin.state.reads).toBe(1);
        // "No plan" is re-read after a minute.
        await billing.shopPlan(admin.gql, shopId, { now: now + 90_000 });
        expect(admin.state.reads).toBe(2);
        await setPlan(shopId, "pro");
        admin.state.fail = true;
        const state = await billing.shopPlan(admin.gql, shopId, {
          force: true,
          bypassThrottle: true,
          now: now + 100_000,
        });
        expect(state).toMatchObject({ plan: "pro", fresh: false });
      });

      it("shares one read between parallel loaders", async () => {
        const admin = fakeAdmin();
        await Promise.all([
          billing.shopPlan(admin.gql, shopId),
          billing.shopPlan(admin.gql, shopId),
        ]);
        expect(admin.state.reads).toBe(1);
      });
    });

    describe("limits", () => {
      it("allows 10 search fields on every plan", async () => {
        await setPlan(shopId, "none");
        // Phones preset: Brand, Series, Model (3 fields).
        for (let i = 3; i < 10; i++) {
          await applyFieldIntent(shopId, { intent: "add" });
        }
        expect(await prisma.searchField.count({ where: { shopId } })).toBe(10);
        await expect(
          applyFieldIntent(shopId, { intent: "add" }),
        ).rejects.toThrow("You can have up to 10 fields.");
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

      it("refuses universal products when the plan doesn't include them", async () => {
        await catalog.replaceCatalog(
          shopId,
          [
            {
              productId: "gid://shopify/Product/1",
              title: "P1",
              handle: "p-1",
              status: "ACTIVE",
              variants: [],
            },
          ],
          await catalog.dbNow(),
        );
        await expect(
          addUniversal(shopId, ["gid://shopify/Product/1"]),
        ).rejects.toThrow(
          "Universal products isn't included in the Starter plan.",
        );
        await setPlan(shopId, "growth");
        expect(await addUniversal(shopId, ["gid://shopify/Product/1"])).toBe(1);
      });

      it("counts linked and universal products against the limit", async () => {
        plansMod.setPlansForTests(starterWithUniversal);
        const products = Array.from({ length: 52 }, (_, i) => ({
          productId: `gid://shopify/Product/${i + 1}`,
          title: `P${i + 1}`,
          handle: `p-${i + 1}`,
          status: "ACTIVE",
          variants: [],
        }));
        await catalog.replaceCatalog(shopId, products, await catalog.dbNow());
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
        // Choose product: the rows take the chosen variant's SKU (S{n}).
        const target = (n: number) => ({
          productId: ids[n],
          variantId: `gid://shopify/ProductVariant/${n + 1}`,
          sku: `S${n}`,
        });
        await linkChosenProduct(shopId, "L1", target(49)); // the 50th product
        await expect(
          linkChosenProduct(shopId, "L2", target(50)),
        ).rejects.toThrow(LinkRuleError);
        await linkChosenProduct(shopId, "L2", target(0)); // already universal: no new product
        await linkChosenProduct(shopId, "S49", target(50)); // replaces its own product: still 50
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
        await linkChosenProduct(shopId, "S0", target(1)); // already counted
        expect(await addUniversal(shopId, [ids[50]])).toBe(1); // linked via S50 already
        await expect(addUniversal(shopId, [ids[51], ids[0]])).resolves.toBe(0);

        // A link whose rows are gone doesn't count (and can't be seen or removed).
        await prisma.fitmentRow.deleteMany({
          where: { shopId, attachment: "S50" },
        });
        expect(await billing.linkedProductCount(shopId)).toBe(51);
      });

      it("lets only one of two parallel universal adds pass the limit", async () => {
        plansMod.setPlansForTests(starterWithUniversal);
        const products = Array.from({ length: 52 }, (_, i) => ({
          productId: `gid://shopify/Product/${i + 1}`,
          title: `P${i + 1}`,
          handle: `p-${i + 1}`,
          status: "ACTIVE",
          variants: [],
        }));
        await catalog.replaceCatalog(shopId, products, await catalog.dbNow());
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
