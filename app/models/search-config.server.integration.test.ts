// Runs against the real Postgres in DATABASE_URL. Skipped when no database is configured.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { upsertShopOnInstall } from "./shop.server";
import {
  SetupExistsError,
  applyStoreType,
  getSetupCounts,
} from "./search-config.server";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env: rely on the environment
}

const A = "vitest-setup-a.myshopify.com";
const B = "vitest-setup-b.myshopify.com";

describe.skipIf(!process.env.DATABASE_URL)("applyStoreType (Postgres)", () => {
  const db = new PrismaClient();
  let shopA: string;
  let shopB: string;

  beforeEach(async () => {
    await db.shop.deleteMany({ where: { domain: { in: [A, B] } } });
    shopA = (await upsertShopOnInstall(A, db)).id;
    shopB = (await upsertShopOnInstall(B, db)).id;
  });

  afterAll(async () => {
    await db.shop.deleteMany({ where: { domain: { in: [A, B] } } });
    await db.$disconnect();
  });

  const fieldLabels = (shopId: string) =>
    db.searchField
      .findMany({ where: { shopId }, orderBy: { position: "asc" } })
      .then((fs) => fs.map((f) => f.label));

  it("creates the config, fields and wording for the chosen type, and no rows", async () => {
    await applyStoreType(shopA, "automotive", { replace: false }, db);

    const config = await db.searchConfig.findUniqueOrThrow({
      where: { shopId: shopA },
    });
    expect(config).toMatchObject({
      storeType: "automotive",
      noun: "vehicle",
      thingsWord: "parts",
      heading: "Find parts for your vehicle",
    });
    expect(await fieldLabels(shopA)).toEqual(["Make", "Year", "Model"]);
    expect(await getSetupCounts(shopA, db)).toEqual({ fields: 3, rows: 0 });
  });

  it("refuses to overwrite an existing setup without replace", async () => {
    await applyStoreType(shopA, "automotive", { replace: false }, db);
    await expect(
      applyStoreType(shopA, "phones", { replace: false }, db),
    ).rejects.toBeInstanceOf(SetupExistsError);
    expect(await fieldLabels(shopA)).toEqual(["Make", "Year", "Model"]);
  });

  it("concurrent first-run submits create one set of fields", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        applyStoreType(shopA, "automotive", { replace: false }, db),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) {
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(SetupExistsError);
      }
    }
    expect(await fieldLabels(shopA)).toEqual(["Make", "Year", "Model"]);
  });

  it("concurrent replaces leave exactly one set of fields", async () => {
    await applyStoreType(shopA, "automotive", { replace: false }, db);
    await Promise.all([
      applyStoreType(shopA, "phones", { replace: true }, db),
      applyStoreType(shopA, "beauty", { replace: true }, db),
    ]);
    // One set of fields, and it belongs to the type the config says.
    const labels = await fieldLabels(shopA);
    const { storeType } = await db.searchConfig.findUniqueOrThrow({
      where: { shopId: shopA },
    });
    expect(labels).toEqual(
      storeType === "phones"
        ? ["Brand", "Series", "Model"]
        : ["Brand", "Product type", "Gender"],
    );
  });

  it("replace swaps fields and deletes rows and mapping, for this shop only", async () => {
    await applyStoreType(shopA, "automotive", { replace: false }, db);
    await applyStoreType(shopB, "automotive", { replace: false }, db);
    for (const shopId of [shopA, shopB]) {
      await db.fitmentRow.create({
        data: { shopId, values: {}, attachment: "SKU-1", rowHash: "h" },
      });
      await db.importMapping.create({
        data: { shopId, columnName: "Make", target: "skip" },
      });
    }
    await db.productLink.create({
      data: { shopId: shopA, attachment: "SKU-1", kind: "sku" },
    });
    await db.universalProduct.create({
      data: { shopId: shopA, productId: "gid://shopify/Product/1" },
    });

    await applyStoreType(shopA, "phones", { replace: true }, db);

    expect(await fieldLabels(shopA)).toEqual(["Brand", "Series", "Model"]);
    expect(await db.fitmentRow.count({ where: { shopId: shopA } })).toBe(0);
    expect(await db.importMapping.count({ where: { shopId: shopA } })).toBe(0);
    expect(await db.productLink.count({ where: { shopId: shopA } })).toBe(1);
    expect(await db.universalProduct.count({ where: { shopId: shopA } })).toBe(
      1,
    );
    const config = await db.searchConfig.findUniqueOrThrow({
      where: { shopId: shopA },
    });
    expect(config).toMatchObject({ storeType: "phones", noun: "phone" });

    // The other shop is untouched.
    expect(await fieldLabels(shopB)).toEqual(["Make", "Year", "Model"]);
    expect(await db.fitmentRow.count({ where: { shopId: shopB } })).toBe(1);
    expect(await db.importMapping.count({ where: { shopId: shopB } })).toBe(1);
  });
});
