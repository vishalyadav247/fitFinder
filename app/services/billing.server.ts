// The shop's plan under the Billing API (subscription.server.ts): read from the Admin API
// (currentAppInstallation.activeSubscriptions) and stored in shops.plan / trial_ends_at, so limit
// checks (imports, row and field adds, links) read it without a network call. The plan is re-read
// at most every 5 minutes per shop when the admin is open, right away when the merchant comes back
// from Shopify's approval page, and on the app_subscriptions/update webhook.
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { shopPlanView } from "../models/plan.server";
import { type AdminGraphql } from "./linking/catalog.server";
import {
  featureMessage,
  limitMessage,
  type LimitKey,
  type ShopPlan,
  type ToggleKey,
  type Usage,
} from "./billing";
import { limitOf } from "./plan-features";
import { syncSubscription } from "./subscription.server";

const CACHE_MS = 5 * 60_000;
// After a failed read, other loads use the stored plan for a while; a forced read still goes through.
const RETRY_AFTER_FAILURE_MS = 60_000;
// "No subscription" is kept briefly only, so a plan just approved shows up soon even without the
// return URL.
const NO_PLAN_CACHE_MS = 60_000;
const MIN_FORCE_MS = 10_000;

export interface PlanState {
  plan: ShopPlan;
  trialEndsAt: Date | null;
  /** Always true since the Billing API (kept for callers written for App Pricing). */
  connected: boolean;
  /** False when the last read failed and the stored plan is shown. */
  fresh: boolean;
}

// Per process: last read per shop, and reads in flight (parallel loaders share one call).
const checkedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<PlanState>>();
const failedAt = new Map<string, number>();
const generations = new Map<string, number>();

export function clearPlanCache() {
  checkedAt.clear();
  inFlight.clear();
  failedAt.clear();
  generations.clear();
}

async function stored(shopId: string, connected: boolean, fresh: boolean) {
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    select: { plan: true, trialEndsAt: true },
  });
  return {
    plan: shop.plan as ShopPlan,
    trialEndsAt: shop.trialEndsAt,
    connected,
    fresh,
  };
}

/**
 * The shop's plan, re-read from the Admin API when the cached read is older than 5 minutes
 * (or `force`). Failures keep the stored plan.
 */
export async function shopPlan(
  gql: AdminGraphql,
  shopId: string,
  {
    force = false,
    bypassThrottle = false,
    now = Date.now(),
    sync = syncSubscription,
  }: {
    force?: boolean;
    /** A forced read even within 10 s of the last one (the billing webhook). */
    bypassThrottle?: boolean;
    now?: number;
    sync?: typeof syncSubscription;
  } = {},
): Promise<PlanState> {
  const last = checkedAt.get(shopId);
  const failed = failedAt.get(shopId);
  // A forced read at most every 10 s per shop (reloads of Plans).
  const recent = Math.max(last ?? -Infinity, failed ?? -Infinity);
  if (force && !bypassThrottle && now - recent < MIN_FORCE_MS) force = false;
  if (!force && last !== undefined && now - last < CACHE_MS) {
    return stored(shopId, true, true);
  }
  if (!force && failed !== undefined && now - failed < RETRY_AFTER_FAILURE_MS) {
    return stored(shopId, true, false);
  }
  // A forced read (back from the plan page) doesn't take an older read's answer.
  const running = inFlight.get(shopId);
  if (running && !force) return running;

  // Only the newest read of a shop records its answer: an older read that finishes after a
  // forced one (e.g. right after an upgrade) must not write the old plan back.
  const generation = (generations.get(shopId) ?? 0) + 1;
  generations.set(shopId, generation);
  const newest = () => generations.get(shopId) === generation;

  // Each read removes only its own entry (a forced read may have replaced it).
  const run = async (): Promise<PlanState> => {
    try {
      const synced = await sync(gql, shopId, new Date(now), newest);
      if (!synced) return stored(shopId, true, true);
      const { plan, trialEndsAt } = synced;
      checkedAt.set(
        shopId,
        plan !== "none" ? now : now - CACHE_MS + NO_PLAN_CACHE_MS,
      );
      failedAt.delete(shopId);
      return { plan, trialEndsAt, connected: true, fresh: true };
    } catch (error) {
      console.error("billing: plan read failed", { shopId, error });
      if (newest()) failedAt.set(shopId, now);
      return stored(shopId, true, false);
    } finally {
      if (inFlight.get(shopId) === read) inFlight.delete(shopId);
    }
  };
  const read = run();
  inFlight.set(shopId, read);
  return read;
}

// ---------------------------------------------------------------- usage and limits

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * The plan's "linked products": products a link with filter rows behind it points to, plus
 * universal products (one query, shared by the meter and every limit check). A link whose rows are
 * gone doesn't count: the merchant couldn't see or remove it. `exceptAttachment` leaves out that
 * attachment's own link (it is about to be replaced). Ids are compared byte-wise (COLLATE "C"):
 * the UNION's de-duplication was 3× slower under the default collation (727k-row shop, M10).
 */
export function linkedProductsSql(shopId: string, exceptAttachment?: string) {
  return Prisma.sql`
    SELECT l.product_id COLLATE "C" AS product_id FROM product_links l
    WHERE l.shop_id = ${shopId} AND l.product_id IS NOT NULL
      ${exceptAttachment === undefined ? Prisma.empty : Prisma.sql`AND l.attachment <> ${exceptAttachment}`}
      AND EXISTS (SELECT 1 FROM fitment_rows f
        WHERE f.shop_id = l.shop_id AND f.attachment = l.attachment)
    UNION
    SELECT u.product_id COLLATE "C" FROM universal_products u WHERE u.shop_id = ${shopId}`;
}

export async function linkedProductCount(shopId: string, db: Db = prisma) {
  const [{ n }] = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (${linkedProductsSql(shopId)}) p`;
  return n;
}

/** Plan usage; pass `rows` when the caller already counted them. */
export async function usage(
  shopId: string,
  db: Db = prisma,
  known: { rows?: number } = {},
): Promise<Usage> {
  const [rows, products] = await Promise.all([
    known.rows ?? db.fitmentRow.count({ where: { shopId } }),
    linkedProductCount(shopId, db),
  ]);
  return { rows, products };
}

/**
 * The refusal message when `next` would be over the shop's limit for `key`, else null. Callers
 * throw it as their own rule error, so routes report it like any other refusal.
 */
export async function overLimitMessage(
  shopId: string,
  key: LimitKey,
  /** The count after the change (only called when the plan has a limit for `key`). */
  countAfter: () => Promise<number>,
  db?: Db,
): Promise<string | null> {
  const plan = await shopPlanView(shopId, db);
  const max = limitOf(plan, key);
  if (max === Infinity) return null;
  return (await countAfter()) > max ? limitMessage(plan, key) : null;
}

/** The refusal message when the shop's plan doesn't include a feature, else null. */
export async function featureRefusal(
  shopId: string,
  key: ToggleKey,
  db?: Db,
): Promise<string | null> {
  const plan = await shopPlanView(shopId, db);
  return plan.toggles[key] ? null : featureMessage(plan, key);
}
