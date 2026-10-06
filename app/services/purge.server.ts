// Shop data removal (BUILD-PLAN §4 Privacy and uninstall; Settings › Your data): an uninstalled
// shop's data is kept 30 days in case it reinstalls, then deleted: files in storage, sessions and
// the shop row (every app table cascades from it). Shopify's shop/redact webhook (48 hours after
// uninstall) asks for the same deletion within 30 days; the daily purge at uninstall + 30 days
// meets that (28 days after the request).
// Docs: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { shopPrefix, storage } from "./storage.server";

export const KEEP_DAYS = 30;
const DAY_MS = 86_400_000;
const BATCH = 100;
// The whole daily run stays inside the job's 1 h expiry.
const RUN_BUDGET_MS = 45 * 60_000;
// Deleting a shop's files can take a while on R2 (pages of 1,000 keys).
const SHOP_TIMEOUT_MS = 5 * 60_000;

/**
 * Deletes everything of one shop, holding its row locked: a reinstall (which updates the row)
 * waits until the purge is done or finds the shop gone, so it can't keep a shop whose files were
 * just deleted. Files go first: if storage fails, the transaction rolls back and the next run
 * tries again (a deleted row would leave the files behind with nothing pointing at them).
 * Returns false when the shop was reinstalled meanwhile.
 */
export async function purgeShop(shop: { id: string; domain: string }) {
  // The big tables first, in short batches outside the lock (a 700k-row shop's cascade would
  // otherwise run inside it); stops as soon as the shop is reinstalled.
  if (!(await emptyBigTables(shop.id))) return false;
  return prisma.$transaction(
    async (tx) => {
      const still = await tx.$queryRaw<unknown[]>`
        SELECT 1 FROM shops WHERE id = ${shop.id} AND uninstalled_at IS NOT NULL
        FOR UPDATE`;
      if (!still.length) return false;
      // Sessions right away: a reinstall stores its new session before it reaches the locked
      // row, so deleting them after the (slow) file delete could remove that new session.
      await tx.session.deleteMany({ where: { shop: shop.domain } });
      await storage().deletePrefix(shopPrefix(shop.id));
      await tx.shop.delete({ where: { id: shop.id } });
      return true;
    },
    { timeout: SHOP_TIMEOUT_MS, maxWait: 10_000 },
  );
}

const ROW_BATCH = 50_000;

/**
 * Deletes the shop's filter rows and import staging rows in batches while it stays uninstalled.
 * Returns false when it was reinstalled meanwhile (whatever is left stays; the shop keeps going).
 */
async function emptyBigTables(shopId: string): Promise<boolean> {
  const uninstalled = Prisma.sql`EXISTS (SELECT 1 FROM shops
    WHERE id = ${shopId} AND uninstalled_at IS NOT NULL)`;
  for (const table of ["fitment_rows", "import_rows"] as const) {
    const owned =
      table === "fitment_rows"
        ? Prisma.sql`shop_id = ${shopId}`
        : Prisma.sql`job_id IN (SELECT id FROM import_jobs WHERE shop_id = ${shopId})`;
    for (;;) {
      const deleted = await prisma.$executeRaw`
        DELETE FROM ${Prisma.raw(table)} WHERE id IN (
          SELECT id FROM ${Prisma.raw(table)} WHERE ${owned} AND ${uninstalled}
          LIMIT ${ROW_BATCH})`;
      if (deleted < ROW_BATCH) break;
    }
  }
  const still = await prisma.shop.count({
    where: { id: shopId, uninstalledAt: { not: null } },
  });
  return still > 0;
}

/** Shops uninstalled more than 30 days ago (and not reinstalled since). `only`: for tests. */
export function dueForPurge(
  now = new Date(),
  only?: string[],
  skip: string[] = [],
) {
  return prisma.shop.findMany({
    where: {
      uninstalledAt: { lt: new Date(now.getTime() - KEEP_DAYS * DAY_MS) },
      ...(only ? { domain: { in: only } } : {}),
      // Shops that failed in this run: excluded in the query, so they can't hide the rest.
      ...(skip.length ? { id: { notIn: skip } } : {}),
    },
    select: { id: true, domain: true, uninstalledAt: true },
    orderBy: { uninstalledAt: "asc" },
    take: BATCH,
  });
}

/**
 * The daily purge job: batches until no shop is due (or the run's time is up). Returns how many
 * shops were deleted; one failure doesn't stop the rest. A shop still here a day after its date
 * is logged as an error: Shopify's shop/redact deadline is 2 days later.
 */
export async function purgeUninstalledShops(
  now = new Date(),
  { only }: { only?: string[] } = {},
) {
  const started = Date.now();
  const failed = new Set<string>();
  let purged = 0;
  for (;;) {
    const due = await dueForPurge(now, only, [...failed]);
    if (!due.length || Date.now() - started > RUN_BUDGET_MS) break;
    for (const shop of due) {
      try {
        if (await purgeShop(shop)) purged++;
      } catch (error) {
        failed.add(shop.id);
        const overdue =
          now.getTime() - shop.uninstalledAt!.getTime() >
          (KEEP_DAYS + 1) * DAY_MS;
        console.error(
          overdue
            ? "purge: OVERDUE shop not deleted (shop/redact deadline at risk)"
            : "purge: shop not deleted, retried tomorrow",
          { shopId: shop.id, error },
        );
      }
    }
    if (due.length < BATCH) break;
  }
  if (purged) console.log(`purge: deleted ${purged} uninstalled shop(s)`);
  return purged;
}
