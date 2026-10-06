// Shop data removal (M10) against the real Postgres in DATABASE_URL, with a temp folder as
// storage: shops uninstalled more than 30 days ago are deleted with their files and sessions;
// recent uninstalls, reinstalled shops and other shops are untouched.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const OLD = "vitest-purge-old.myshopify.com";
const RECENT = "vitest-purge-recent.myshopify.com";
const ACTIVE = "vitest-purge-active.myshopify.com";
const DOMAINS = [OLD, RECENT, ACTIVE];

try {
  process.loadEnvFile(".env");
} catch {
  // no .env: rely on the environment
}

const { default: prisma } = await import("../db.server");
const { upsertShopOnInstall } = await import("../models/shop.server");
const { applyStoreType } = await import("../models/search-config.server");
const storageMod = await import("./storage.server");
const { purgeUninstalledShops, purgeShop } = await import("./purge.server");

const DAY = 86_400_000;

describe.skipIf(!process.env.DATABASE_URL)("purge (Postgres)", () => {
  let dir: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "ff-purge-"));
    storageMod.setStorageForTests(new storageMod.LocalStorage(dir));
  });
  afterAll(async () => {
    await prisma.shop.deleteMany({ where: { domain: { in: DOMAINS } } });
    await prisma.session.deleteMany({ where: { shop: { in: DOMAINS } } });
    storageMod.setStorageForTests(undefined);
    await rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await prisma.shop.deleteMany({ where: { domain: { in: DOMAINS } } });
    await prisma.session.deleteMany({ where: { shop: { in: DOMAINS } } });
    for (const domain of DOMAINS) {
      const shop = await upsertShopOnInstall(domain);
      ids[domain] = shop.id;
      await applyStoreType(shop.id, "automotive", { replace: false });
      await storageMod
        .storage()
        .put(storageMod.newUploadKey(shop.id, "data.csv"), "a,b\n");
      await prisma.session.create({
        data: {
          id: `offline_${domain}`,
          shop: domain,
          state: "s",
          isOnline: false,
          accessToken: "t",
        },
      });
    }
    const now = Date.now();
    await prisma.shop.update({
      where: { id: ids[OLD] },
      data: { uninstalledAt: new Date(now - 31 * DAY) },
    });
    await prisma.shop.update({
      where: { id: ids[RECENT] },
      data: { uninstalledAt: new Date(now - 29 * DAY) },
    });
  });

  const folders = async () =>
    (await readdir(path.join(dir, "imports")).catch(() => [])).sort();

  it("deletes shops uninstalled more than 30 days ago, with files and sessions", async () => {
    // Only this test's shops (the dev database may hold others).
    expect(await purgeUninstalledShops(new Date(), { only: DOMAINS })).toBe(1);
    const left = await prisma.shop.findMany({
      where: { domain: { in: DOMAINS } },
      select: { domain: true },
    });
    expect(left.map((s) => s.domain).sort()).toEqual([ACTIVE, RECENT].sort());
    // Cascade: nothing of the old shop is left.
    expect(
      await prisma.searchField.count({ where: { shopId: ids[OLD] } }),
    ).toBe(0);
    expect(await prisma.session.count({ where: { shop: OLD } })).toBe(0);
    expect(await prisma.session.count({ where: { shop: RECENT } })).toBe(1);
    expect(await folders()).toEqual([ids[ACTIVE], ids[RECENT]].sort());
  });

  it("keeps a shop that reinstalled after it was picked", async () => {
    const picked = { id: ids[OLD], domain: OLD };
    await upsertShopOnInstall(OLD); // reinstall clears uninstalledAt
    expect(await purgeShop(picked)).toBe(false);
    expect(await prisma.shop.count({ where: { id: ids[OLD] } })).toBe(1);
    expect(await prisma.session.count({ where: { shop: OLD } })).toBe(1);
    expect(await folders()).toContain(ids[OLD]);
  });
});
