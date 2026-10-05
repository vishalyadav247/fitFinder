// The shop's link check (catalog_syncs, one row per shop): queued by "Check links again", by the
// first visit to Product mapping and after every import; run by the pg-boss "links" queue
// (jobs.server.ts). A full check reloads the catalog cache from Shopify (bulk export of products
// and variants, then collections) before matching; a quick one only matches against the cache.
// Guarded like imports: each queued run carries an attempt number, a running run heartbeats, and a
// run whose worker died is shown as failed instead of blocking the button.
import type { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import {
  cancelBulk,
  collectBulkLines,
  dbNow,
  fetchCollections,
  fetchJsonlLines,
  fetchProduct,
  replaceCatalog,
  startBulkExport,
  upsertProducts,
  waitForBulk,
  type AdminGraphql,
} from "./catalog.server";
import { relink, relinkProduct, removeProduct } from "./relink.server";

const HEARTBEAT_MS = 30_000;
export const LINK_STALE_MS = 3 * 60_000;
// Waiting behind other shops' runs in the queue (see pipeline.server.ts QUEUE_STALE_MS).
export const LINK_QUEUE_STALE_MS = 6 * 60 * 60_000;
const STOPPED = "The link check stopped unexpectedly.";
const FAILED = "Links couldn't be checked. Try again.";

export type LinkCheckStatus =
  "idle" | "queued" | "running" | "completed" | "failed";

export interface LinkCheckView {
  status: LinkCheckStatus;
  attempt: number;
  newMatches: number;
  error: string | null;
  /** The catalog cache was filled at least once. */
  catalogReady: boolean;
}

/** Fails a run whose worker died (no heartbeat) or that never left the queue. */
async function sweepStaleRun(shopId: string, now = Date.now()) {
  const stale: Prisma.CatalogSyncWhereInput = {
    shopId,
    OR: [
      {
        status: "running",
        updatedAt: { lt: new Date(now - LINK_STALE_MS) },
      },
      {
        status: "queued",
        startedAt: { lt: new Date(now - LINK_QUEUE_STALE_MS) },
      },
    ],
  };
  const dead = await prisma.catalogSync.findFirst({
    where: stale,
    select: {
      bulkOperationId: true,
      status: true,
      shop: { select: { domain: true } },
    },
  });
  if (!dead) return;
  const { count } = await prisma.catalogSync.updateMany({
    where: stale,
    data: { status: "failed", error: STOPPED, finishedAt: new Date() },
  });
  // Its bulk export may still be running at Shopify: cancel it (best effort, in the background).
  if (count > 0 && dead.status === "running" && dead.bulkOperationId) {
    const id = dead.bulkOperationId;
    void defaultGqlFor(dead.shop.domain)
      .then((gql) => cancelBulk(gql, id))
      .catch(() => undefined);
  }
}

export async function linkCheckState(shopId: string): Promise<LinkCheckView> {
  await sweepStaleRun(shopId);
  const row = await prisma.catalogSync.findUnique({ where: { shopId } });
  if (!row) {
    return {
      status: "idle",
      attempt: 0,
      newMatches: 0,
      error: null,
      catalogReady: false,
    };
  }
  return {
    status: row.status,
    attempt: row.attempt,
    newMatches: row.newMatches,
    error: row.error,
    catalogReady: row.syncedAt !== null,
  };
}

/**
 * Queues a link check unless one is waiting or running. A quick check becomes a full one while
 * the catalog was never loaded. Returns the attempt to put in the queue message, or null when a
 * run is already on its way (a waiting quick run is upgraded to full if asked).
 */
export async function prepareLinkCheck(
  shopId: string,
  { fullSync }: { fullSync: boolean },
): Promise<number | null> {
  await sweepStaleRun(shopId);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO catalog_syncs (shop_id, status, full_sync, attempt, updated_at)
      VALUES (${shopId}, 'completed', true, 0, now())
      ON CONFLICT (shop_id) DO NOTHING`;
    const [row] = await tx.$queryRaw<
      {
        status: string;
        full_sync: boolean;
        attempt: number;
        synced_at: Date | null;
      }[]
    >`SELECT status::text, full_sync, attempt, synced_at FROM catalog_syncs
      WHERE shop_id = ${shopId} FOR UPDATE`;
    const full = fullSync || row.synced_at === null;
    if (row.status === "queued") {
      if (full && !row.full_sync) {
        await tx.catalogSync.update({
          where: { shopId },
          data: { fullSync: true },
        });
      }
      return null;
    }
    if (row.status === "running") {
      // The running check may have read the rows or catalog too early: run again when it ends.
      await tx.$executeRaw`
        UPDATE catalog_syncs SET pending_full_sync = coalesce(pending_full_sync, false) OR ${full}
        WHERE shop_id = ${shopId}`;
      return null;
    }
    const next = await tx.catalogSync.update({
      where: { shopId },
      data: {
        status: "queued",
        fullSync: full,
        attempt: { increment: 1 },
        bulkOperationId: null,
        newMatches: 0,
        error: null,
        startedAt: new Date(),
        finishedAt: null,
        pendingFullSync: null,
      },
    });
    return next.attempt;
  });
}

/** Admin API access for a shop outside a request (offline token, refreshed by the library). */
async function defaultGqlFor(domain: string): Promise<AdminGraphql> {
  const { unauthenticated } = await import("../../shopify.server");
  const { admin } = await unauthenticated.admin(domain);
  return admin.graphql as unknown as AdminGraphql;
}

/** The job: claim the queued attempt, optionally reload the catalog, match, record the result. */
export async function runLinkCheck(
  shopId: string,
  attempt: number,
  gqlFor: (domain: string) => Promise<AdminGraphql> = defaultGqlFor,
) {
  const claimed = await prisma.catalogSync.updateMany({
    where: { shopId, attempt, status: "queued" },
    data: { status: "running" },
  });
  if (claimed.count === 0) return;
  const mine = { shopId, attempt, status: "running" as const };
  const beat = () =>
    prisma.catalogSync
      .updateMany({ where: mine, data: { updatedAt: new Date() } })
      .then(() => undefined);
  const timer = setInterval(() => {
    beat().catch((error) =>
      console.error("link check heartbeat failed", { shopId, error }),
    );
  }, HEARTBEAT_MS);
  timer.unref();

  try {
    const run = await prisma.catalogSync.findUniqueOrThrow({
      where: { shopId },
      select: { fullSync: true, shop: { select: { domain: true } } },
    });
    if (run.fullSync) {
      const domain = run.shop.domain;
      const exportStartedAt = await dbNow();
      const opId = await startBulkExport(await gqlFor(domain));
      await prisma.catalogSync.updateMany({
        where: mine,
        data: { bulkOperationId: opId },
      });
      const url = await waitForBulk(() => gqlFor(domain), opId, beat);
      const products = url ? await collectBulkLines(fetchJsonlLines(url)) : [];
      const collections = await fetchCollections(await gqlFor(domain));
      await beat();
      await replaceCatalog(shopId, products, collections, exportStartedAt);
    }
    const newMatches = await relink(shopId, { pruneMissing: run.fullSync });
    await prisma.catalogSync.updateMany({
      where: mine,
      data: {
        status: "completed",
        newMatches,
        finishedAt: new Date(),
        ...(run.fullSync ? { syncedAt: new Date() } : {}),
      },
    });
  } catch (error) {
    console.error("link check failed", { shopId, attempt, error });
    await prisma.catalogSync.updateMany({
      where: mine,
      data: { status: "failed", error: FAILED, finishedAt: new Date() },
    });
  } finally {
    clearInterval(timer);
  }
}

/**
 * Takes the check asked for while the last one ran (null: none). Called after a run has ended;
 * the caller queues it (jobs.server.ts).
 */
export async function takePendingRun(shopId: string): Promise<boolean | null> {
  const rows = await prisma.$queryRaw<{ pending: boolean | null }[]>`
    UPDATE catalog_syncs s SET pending_full_sync = NULL
    FROM (SELECT shop_id, pending_full_sync AS pending FROM catalog_syncs
          WHERE shop_id = ${shopId} AND status IN ('completed', 'failed') FOR UPDATE) old
    WHERE s.shop_id = old.shop_id AND old.pending IS NOT NULL
    RETURNING old.pending`;
  return rows[0]?.pending ?? null;
}

/**
 * products/create|update|delete job: reads the product again from Shopify (so late, duplicate or
 * out-of-order webhooks can't leave stale data), updates the cache and relinks what it affects.
 */
export async function syncProduct(
  shopId: string,
  productId: string,
  gqlFor: (domain: string) => Promise<AdminGraphql> = defaultGqlFor,
) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { domain: true, uninstalledAt: true },
  });
  if (!shop || shop.uninstalledAt) return;
  const product = await fetchProduct(await gqlFor(shop.domain), productId);
  // Don't hold a connection waiting behind a long link check: fail fast, pg-boss retries later.
  const lockTimeout = "5s";
  if (!product) {
    await removeProduct(shopId, productId, { lockTimeout });
    return;
  }
  await upsertProducts(shopId, [product], { replaceVariants: true });
  await relinkProduct(shopId, product, { lockTimeout });
}
