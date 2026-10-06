// The shop's plan under Shopify App Pricing: read from the Partner API (activeSubscription), not
// the Admin API, and stored in shops.plan / trial_ends_at so limit checks (imports, row and field
// adds, links) read it without a network call. Shopify App Pricing sends no billing webhooks, so
// the plan is re-read at most every 5 minutes per shop when the admin is open, and right away after
// the plan page sends the merchant back (welcome link with plan_handle).
// Docs: https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/redirect-plan-selection-page,
// https://shopify.dev/docs/api/partner/2026-07/active-subscription
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { gqlData, type AdminGraphql } from "./linking/catalog.server";
import {
  effectivePlan,
  limitMessage,
  planFromHandles,
  type Limits,
  type ShopPlan,
  type Usage,
} from "./billing";

const PARTNER_API_VERSION = "2026-07";
const CACHE_MS = 5 * 60_000;
// After a failed read, other loads use the stored plan for a while (Partner API: 4 requests per
// second per client, shared by every shop); a forced read still goes through.
const RETRY_AFTER_FAILURE_MS = 60_000;
// "No subscription" is kept briefly only (docs: cache confirmed subscriptions), so a plan just
// approved shows up soon even without the welcome link.
const NO_PLAN_CACHE_MS = 60_000;
const MIN_FORCE_MS = 10_000;
const TIMEOUT_MS = 8000;

export interface PartnerConfig {
  orgId: string;
  token: string;
  appGid: string;
}

/** Partner API credentials from the environment, or null when billing isn't connected. */
export function partnerConfig(env = process.env): PartnerConfig | null {
  const orgId = env.SHOPIFY_PARTNER_ORG_ID;
  const token = env.SHOPIFY_PARTNER_API_ACCESS_TOKEN;
  const appGid = env.SHOPIFY_APP_GID;
  return orgId && token && appGid ? { orgId, token, appGid } : null;
}

/** The app's handle (shopify.app.toml / Partner Dashboard) for the plan page URL. */
export const appHandle = (env = process.env) => env.SHOPIFY_APP_HANDLE || null;

export interface Subscription {
  handles: string[];
  trialEndsAt: string | null;
  billingPeriod: string | null;
}

const ACTIVE_SUBSCRIPTION = `query ActiveSubscription($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    billingPeriod
    trialEndsAt
    items { handle description }
  }
}`;

/**
 * The shop's active subscription, or null when it has none. Throws on throttling and other
 * failures, so an outage never looks like "no plan".
 */
export async function fetchActiveSubscription(
  config: PartnerConfig,
  shopGid: string,
  fetcher: typeof fetch = fetch,
): Promise<Subscription | null> {
  const res = await fetcher(
    `https://partners.shopify.com/${encodeURIComponent(config.orgId)}/api/${PARTNER_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": config.token,
      },
      body: JSON.stringify({
        query: ACTIVE_SUBSCRIPTION,
        variables: { appId: config.appGid, shopId: shopGid },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  const body = (await res.json().catch(() => null)) as {
    data?: {
      activeSubscription: {
        billingPeriod: string | null;
        trialEndsAt: string | null;
        items: { handle: string }[];
      } | null;
    };
    errors?: unknown;
  } | null;
  if (!res.ok || !body || body.errors || !body.data) {
    throw new Error(
      `Partner API request failed: ${JSON.stringify(body?.errors ?? res.status).slice(0, 300)}`,
    );
  }
  const sub = body.data.activeSubscription;
  if (!sub) return null;
  return {
    handles: sub.items.map((i) => i.handle),
    trialEndsAt: sub.trialEndsAt,
    billingPeriod: sub.billingPeriod,
  };
}

export interface PlanState {
  plan: ShopPlan;
  trialEndsAt: Date | null;
  /** Partner API credentials are set (else plan changes can't be read). */
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

const SHOP_GID = `#graphql
  query ShopGid { shop { id } }`;

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
 * The shop's plan, re-read from the Partner API when the cached read is older than 5 minutes
 * (or `force`). Failures keep the stored plan.
 */
export async function shopPlan(
  gql: AdminGraphql,
  shopId: string,
  {
    force = false,
    config = partnerConfig(),
    fetcher = fetch as typeof fetch,
    now = Date.now(),
  } = {},
): Promise<PlanState> {
  if (!config) return stored(shopId, false, true);
  const last = checkedAt.get(shopId);
  const failed = failedAt.get(shopId);
  // A forced read at most every 10 s per shop (reloads of Plans share the Partner rate limit).
  const recent = Math.max(last ?? -Infinity, failed ?? -Infinity);
  if (force && now - recent < MIN_FORCE_MS) force = false;
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
      const { shop } = await gqlData<{ shop: { id: string } }>(gql, SHOP_GID);
      const sub = await fetchActiveSubscription(config, shop.id, fetcher);
      const plan: ShopPlan = sub ? planFromHandles(sub.handles) : "none";
      const trialEndsAt = sub?.trialEndsAt ? new Date(sub.trialEndsAt) : null;
      if (!newest()) return stored(shopId, true, true);
      await prisma.shop.update({
        where: { id: shopId },
        data: { plan, trialEndsAt },
      });
      checkedAt.set(shopId, sub ? now : now - CACHE_MS + NO_PLAN_CACHE_MS);
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

export async function storedPlan(shopId: string, db: Db = prisma) {
  const shop = await db.shop.findUnique({
    where: { id: shopId },
    select: { plan: true },
  });
  return shop?.plan ?? "none";
}

/**
 * The plan's "linked products": products a link with filter rows behind it points to, plus
 * universal products (one query, shared by the meter and every limit check). A link whose rows are
 * gone doesn't count: the merchant couldn't see or remove it. `exceptAttachment` leaves out that
 * attachment's own link (it is about to be replaced).
 */
export function linkedProductsSql(shopId: string, exceptAttachment?: string) {
  return Prisma.sql`
    SELECT l.product_id FROM product_links l
    WHERE l.shop_id = ${shopId} AND l.product_id IS NOT NULL
      ${exceptAttachment === undefined ? Prisma.empty : Prisma.sql`AND l.attachment <> ${exceptAttachment}`}
      AND EXISTS (SELECT 1 FROM fitment_rows f
        WHERE f.shop_id = l.shop_id AND f.attachment = l.attachment)
    UNION
    SELECT u.product_id FROM universal_products u WHERE u.shop_id = ${shopId}`;
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
  key: keyof Limits,
  /** The count after the change (only called when the plan has a limit for `key`). */
  countAfter: () => Promise<number>,
  db: Db = prisma,
): Promise<string | null> {
  const plan = await storedPlan(shopId, db);
  const max = effectivePlan(plan).limits[key];
  if (max === Infinity) return null;
  return (await countAfter()) > max ? limitMessage(plan, key) : null;
}
