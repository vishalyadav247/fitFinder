// Background jobs (pg-boss on the app's Postgres, schema "pgboss"). Imports run here, never in a
// request. The web process starts the workers itself unless JOBS_INLINE=false; in production a
// separate worker process (scripts/worker.ts) can run them instead.
import { PgBoss } from "pg-boss";
import prisma from "../db.server";
import { runImport, runPreview, sweepStale } from "./import/pipeline.server";
import {
  prepareLinkCheck,
  runLinkCheck,
  syncProduct,
  takePendingRun,
} from "./linking/link-runs.server";
import { purgeUninstalledShops } from "./purge.server";
import { purgeOldStats } from "../models/analytics.server";
import { purgeOldLogs } from "./logs/logs.server";
import { publishForShop } from "./storefront/sync.server";

export const QUEUES = {
  importPreview: "import-preview",
  importRun: "import-run",
  links: "links",
  productSync: "product-sync",
  purge: "purge-uninstalled",
  storefrontPublish: "storefront-publish",
} as const;
type ImportQueue = typeof QUEUES.importPreview | typeof QUEUES.importRun;

export const PURGE_CRON = "15 3 * * *";

// One import step can take a while on 700k rows; our own job row tracks state, so no retries.
const QUEUE_OPTIONS = { retryLimit: 0, expireInSeconds: 60 * 60 };
// products/* webhooks: one job per product waiting and one running at most ("stately" with the
// product as singletonKey), so a burst of updates collapses. The job reads the product again from
// Shopify, so retrying is safe.
const PRODUCT_SYNC_OPTIONS = {
  policy: "stately",
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 10 * 60,
};

// After an import: publish the theme's config again (its first dropdown values changed). One job
// waiting and one running per shop at most; the job publishes whatever is current, so a burst of
// imports collapses. Publishing is idempotent, so retrying is safe.
const PUBLISH_OPTIONS = {
  policy: "stately",
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 10 * 60,
};

const queueOptions = (name: string) =>
  name === QUEUES.productSync
    ? PRODUCT_SYNC_OPTIONS
    : name === QUEUES.storefrontPublish
      ? PUBLISH_OPTIONS
      : QUEUE_OPTIONS;

declare global {
  // eslint-disable-next-line no-var
  var sparefitBoss: Promise<PgBoss> | undefined;
  // eslint-disable-next-line no-var
  var sparefitWorkers: Promise<void> | undefined;
}

function connect(): Promise<PgBoss> {
  if (!global.sparefitBoss) {
    global.sparefitBoss = (async () => {
      const boss = new PgBoss({
        connectionString: process.env.DATABASE_URL,
        // PGBOSS_SCHEMA: the end-to-end tests use their own queues, apart from a running dev server.
        schema: process.env.PGBOSS_SCHEMA || "pgboss",
        application_name: "sparefit-jobs",
      });
      boss.on("error", (error) => console.error("pg-boss error", error));
      await boss.start();
      for (const name of Object.values(QUEUES)) {
        await boss.createQueue(name, queueOptions(name));
      }
      return boss;
    })();
    global.sparefitBoss.catch(() => {
      global.sparefitBoss = undefined;
    });
  }
  return global.sparefitBoss;
}

async function send(name: string, data: object) {
  // If the workers failed to start earlier (e.g. Postgres not ready at boot), try again now.
  if (jobsRunInline()) void startWorkers();
  const boss = await connect();
  await boss.send(name, data, QUEUE_OPTIONS);
}

export function enqueue(
  name: ImportQueue,
  data: { jobId: string; attempt: number },
) {
  return send(name, data);
}

/**
 * Queues a link check for the shop (Product mapping). `fullSync` reloads the catalog from
 * Shopify first. Returns false when one is already waiting or running.
 */
export async function requestLinkCheck(
  shopId: string,
  { fullSync }: { fullSync: boolean },
): Promise<boolean> {
  const attempt = await prepareLinkCheck(shopId, { fullSync });
  if (attempt === null) return false;
  try {
    await send(QUEUES.links, { shopId, attempt });
  } catch (error) {
    // Not queued: don't leave the run "queued" for hours.
    await prisma.catalogSync.updateMany({
      where: { shopId, attempt, status: "queued" },
      data: {
        status: "failed",
        error: "Links couldn't be checked. Try again.",
      },
    });
    throw error;
  }
  return true;
}

/** products/* webhook: refresh this product in the cache and its links, in the background. */
export async function queueProductSync(shopId: string, productId: string) {
  if (jobsRunInline()) void startWorkers();
  const boss = await connect();
  // null when the same product already waits in the queue: that job will read the latest state.
  await boss.send(
    QUEUES.productSync,
    { shopId, productId },
    { ...PRODUCT_SYNC_OPTIONS, singletonKey: `${shopId}:${productId}` },
  );
}

/**
 * A check asked for while the last one ran is queued once it has ended: by the worker, or by the
 * next status read when the run died and was swept (Product mapping loader, /api/links/status).
 */
export async function runPendingCheck(shopId: string) {
  const pending = await takePendingRun(shopId);
  if (pending !== null) await requestLinkCheck(shopId, { fullSync: pending });
}

/** The theme's copy of the storefront config is published again in the background. */
export async function queueStorefrontPublish(shopId: string) {
  if (jobsRunInline()) void startWorkers();
  const boss = await connect();
  // null when the shop already has one waiting: that job publishes the latest config.
  await boss.send(
    QUEUES.storefrontPublish,
    { shopId },
    { ...PUBLISH_OPTIONS, singletonKey: shopId },
  );
}

/**
 * After a finished import its new attachments are matched (.claude/archive/BUILD-PLAN.md §4 Import, step 6), and
 * the theme gets the new first dropdown values (config.ts › first).
 */
async function afterImport(jobId: string) {
  const job = await prisma.importJob.findUnique({
    where: { id: jobId },
    select: { shopId: true, status: true },
  });
  if (job?.status !== "completed") return;
  const [link, publish] = await Promise.allSettled([
    requestLinkCheck(job.shopId, { fullSync: false }),
    queueStorefrontPublish(job.shopId),
  ]);
  if (link.status === "rejected") {
    console.error("couldn't queue linking after import", {
      jobId,
      error: link.reason,
    });
  }
  if (publish.status === "rejected") {
    console.error("couldn't queue the storefront publish after import", {
      jobId,
      error: publish.reason,
    });
  }
}

/** Registers the job handlers once per process. */
export function startWorkers(): Promise<void> {
  if (!global.sparefitWorkers) {
    global.sparefitWorkers = (async () => {
      const boss = await connect();
      await boss.work<{ jobId: string; attempt: number }>(
        QUEUES.importPreview,
        { localConcurrency: 2 },
        async ([job]) => runPreview(job.data.jobId, job.data.attempt),
      );
      await boss.work<{ jobId: string; attempt: number }>(
        QUEUES.importRun,
        { localConcurrency: 1 },
        async ([job]) => {
          await runImport(job.data.jobId, job.data.attempt);
          await afterImport(job.data.jobId).catch((error) =>
            console.error("couldn't run the after-import steps", {
              jobId: job.data.jobId,
              error,
            }),
          );
        },
      );
      await boss.work<{ shopId: string; attempt: number }>(
        QUEUES.links,
        { localConcurrency: 2 },
        async ([job]) => {
          await runLinkCheck(job.data.shopId, job.data.attempt);
          await runPendingCheck(job.data.shopId).catch((error) =>
            console.error("couldn't queue the requested link check", {
              shopId: job.data.shopId,
              error,
            }),
          );
        },
      );
      await boss.work<{ shopId: string; productId: string }>(
        QUEUES.productSync,
        { localConcurrency: 2 },
        async ([job]) => syncProduct(job.data.shopId, job.data.productId),
      );
      await boss.work<{ shopId: string }>(
        QUEUES.storefrontPublish,
        { localConcurrency: 2 },
        async ([job]) => {
          try {
            await publishForShop(job.data.shopId);
          } catch (error) {
            // Logged here, then thrown so pg-boss retries; after the last retry the next admin
            // visit queues it again (app.tsx).
            console.error("storefront publish job failed", {
              shopId: job.data.shopId,
              jobId: job.id,
              error,
            });
            throw error;
          }
        },
      );
      // JOBS_SCHEDULES=false (end-to-end tests): no daily purge and no sweep of every shop's
      // imports; those act on the whole database, not just the test's shops.
      if (process.env.JOBS_SCHEDULES !== "false") {
        // Uninstalled shops are deleted 30 days later (purge.server.ts), analytics counts after
        // 180 days, and log entries after the backoffice's retention (7, 14 or 30 days). Once a day, at 03:15 UTC; pg-boss runs a schedule once across all processes.
        await boss.work(QUEUES.purge, { localConcurrency: 1 }, async () => {
          await purgeUninstalledShops();
          await purgeOldStats();
          await purgeOldLogs();
        });
        await boss.schedule(QUEUES.purge, PURGE_CRON, null, {
          tz: "UTC",
          // A run missed while the app was down (e.g. a deploy at 03:15) still happens once.
          missed: "once",
        });
        // Jobs left behind by a crash or redeploy stop locking their shop.
        const sweep = () =>
          sweepStale().catch((error) =>
            console.error("stale import sweep failed", error),
          );
        await sweep();
        setInterval(sweep, 60_000).unref();
      }
      console.log("SpareFit job workers started");
    })();
    global.sparefitWorkers.catch((error) => {
      console.error("Couldn't start job workers", error);
      global.sparefitWorkers = undefined;
    });
  }
  return global.sparefitWorkers;
}

export function jobsRunInline() {
  return process.env.JOBS_INLINE !== "false";
}
