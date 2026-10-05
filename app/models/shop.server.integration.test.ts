// Runs against the real Postgres in DATABASE_URL (local: Docker container fitfinder-db).
// Skipped when no database is configured.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { markShopUninstalled, upsertShopOnInstall } from "./shop.server";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env: rely on the environment
}

const hasDb = !!process.env.DATABASE_URL;
const DOMAIN = "vitest-integration.myshopify.com";

describe.skipIf(!hasDb)("shops lifecycle (Postgres)", () => {
  const db = new PrismaClient();

  beforeEach(async () => {
    await db.shop.deleteMany({ where: { domain: DOMAIN } });
  });

  afterAll(async () => {
    await db.shop.deleteMany({ where: { domain: DOMAIN } });
    await db.$disconnect();
  });

  it("parallel first installs create exactly one row", async () => {
    await Promise.all(
      Array.from({ length: 5 }, () => upsertShopOnInstall(DOMAIN, db)),
    );
    expect(await db.shop.count({ where: { domain: DOMAIN } })).toBe(1);
  });

  it("a late uninstall webhook doesn't undo a reinstall", async () => {
    await upsertShopOnInstall(DOMAIN, db);
    const uninstalledAt = new Date();
    expect(await markShopUninstalled(DOMAIN, uninstalledAt, db)).toBe(true);

    await new Promise((r) => setTimeout(r, 5));
    const reinstalled = await upsertShopOnInstall(DOMAIN, db);
    expect(reinstalled.uninstalledAt).toBeNull();

    // The same (retried) webhook arrives again after the reinstall.
    expect(await markShopUninstalled(DOMAIN, uninstalledAt, db)).toBe(false);
    const shop = await db.shop.findUniqueOrThrow({ where: { domain: DOMAIN } });
    expect(shop.uninstalledAt).toBeNull();
  });

  it("a first uninstall delivery arriving after a reinstall is ignored", async () => {
    await upsertShopOnInstall(DOMAIN, db);
    await new Promise((r) => setTimeout(r, 5));
    const uninstalledAt = new Date(); // merchant uninstalls; webhook delivery is delayed
    await new Promise((r) => setTimeout(r, 5));
    await upsertShopOnInstall(DOMAIN, db); // reinstall before the webhook is processed

    expect(await markShopUninstalled(DOMAIN, uninstalledAt, db)).toBe(false);
    const shop = await db.shop.findUniqueOrThrow({ where: { domain: DOMAIN } });
    expect(shop.uninstalledAt).toBeNull();
  });

  it("deleting a shop removes its rows in every app table", async () => {
    const shop = await upsertShopOnInstall(DOMAIN, db);
    const shopId = shop.id;
    const field = await db.searchField.create({
      data: { shopId, position: 0, label: "Make" },
    });
    await db.searchConfig.create({
      data: {
        shopId,
        storeType: "automotive",
        heading: "Find parts for your vehicle",
        noun: "vehicle",
        thingsWord: "parts",
      },
    });
    await db.fitmentRow.create({
      data: {
        shopId,
        values: { [field.id]: "BMW" },
        attachment: "SKU-1",
        rowHash: "h1",
      },
    });
    await db.productLink.create({
      data: { shopId, attachment: "SKU-1", kind: "sku" },
    });
    await db.universalProduct.create({
      data: { shopId, productId: "gid://1" },
    });
    await db.importMapping.create({
      data: { shopId, columnName: "Make", target: `field:${field.id}` },
    });
    await db.importJob.create({ data: { shopId, fileName: "a.csv" } });
    await db.storefrontSettings.create({ data: { shopId } });
    await db.themeStatus.create({ data: { shopId, themeId: "1" } });

    await db.shop.delete({ where: { id: shopId } });

    const where = { where: { shopId } };
    const counts = await Promise.all([
      db.searchConfig.count(where),
      db.searchField.count(where),
      db.fitmentRow.count(where),
      db.productLink.count(where),
      db.universalProduct.count(where),
      db.importMapping.count(where),
      db.importJob.count(where),
      db.storefrontSettings.count(where),
      db.themeStatus.count(where),
    ]);
    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
