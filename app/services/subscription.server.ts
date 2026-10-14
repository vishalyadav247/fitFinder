// Billing API (Manual Pricing, agreed 2026-10-13): the app creates the charge with the plan's
// price and trial from the plans table, records it in app_subscriptions, and reads the active one
// back from the Admin API. The merchant approves the charge on Shopify's confirmation page.
// Docs (2026-10): https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/appSubscriptionCreate,
// .../mutations/appSubscriptionCancel, .../objects/AppInstallation (activeSubscriptions),
// https://shopify.dev/docs/apps/launch/billing/manual-pricing/subscription-billing/offer-free-trials
import prisma from "../db.server";
import { getPlan, getPlans } from "../models/plan.server";
import { gqlData, type AdminGraphql } from "./linking/catalog.server";
import { trialDaysFor, type PlanView } from "./billing";

const DAY = 86_400_000;

export type Interval = "monthly" | "yearly";
const SHOPIFY_INTERVAL: Record<Interval, "EVERY_30_DAYS" | "ANNUAL"> = {
  monthly: "EVERY_30_DAYS",
  yearly: "ANNUAL",
};

/** A refusal the Plans page shows to the merchant. */
export class BillingError extends Error {}

/** The app's handle (shopify.app.toml) for the URL Shopify sends the merchant back to. */
export const appHandle = (env = process.env) =>
  env.SHOPIFY_APP_HANDLE || "sparefit";

/** Where Shopify sends the merchant after approving or declining the charge. */
export function returnUrl(shopDomain: string, handle = appHandle()) {
  const store = shopDomain.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${encodeURIComponent(store)}/apps/${encodeURIComponent(handle)}/app/plans?charge=1`;
}

const CREATE = `#graphql
  mutation SubscriptionCreate(
    $name: String!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $returnUrl: URL!
    $trialDays: Int
    $test: Boolean
    $replacementBehavior: AppSubscriptionReplacementBehavior
  ) {
    appSubscriptionCreate(
      name: $name
      lineItems: $lineItems
      returnUrl: $returnUrl
      trialDays: $trialDays
      test: $test
      replacementBehavior: $replacementBehavior
    ) {
      appSubscription { id status trialDays }
      confirmationUrl
      userErrors { field message }
    }
  }`;

const CANCEL = `#graphql
  mutation SubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription { id status }
      userErrors { field message }
    }
  }`;

const ACTIVE = `#graphql
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        createdAt
        lineItems {
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing {
                interval
                price { amount }
              }
            }
          }
        }
      }
    }
  }`;

const DEV_STORE = `#graphql
  query ShopPlanKind { shop { plan { partnerDevelopment } } }`;

interface UserError {
  field: string[] | null;
  message: string;
}

/**
 * Trial days the shop has already used: per charge it approved, the days from activation to its
 * end (or now), at most the charge's trial. Kept across reinstalls until the shop is purged.
 */
export async function trialDaysUsed(shopId: string, now = new Date()) {
  const subs = await prisma.appSubscription.findMany({
    where: { shopId, activatedAt: { not: null }, trialDays: { gt: 0 } },
    select: { activatedAt: true, endedAt: true, trialDays: true },
  });
  return subs.reduce((sum, s) => {
    const end = s.endedAt ?? now;
    // A started day counts: short cycles of subscribe → cancel can't renew the trial.
    const days = Math.ceil((end.getTime() - s.activatedAt!.getTime()) / DAY);
    return sum + Math.min(s.trialDays, Math.max(0, days));
  }, 0);
}

/** Test charges on development stores, or everywhere when SHOPIFY_BILLING_TEST=true. */
async function isTest(gql: AdminGraphql, env = process.env) {
  // Never in production: a forced test charge there would never bill.
  if (env.SHOPIFY_BILLING_TEST === "true" && env.NODE_ENV !== "production") {
    return true;
  }
  const { shop } = await gqlData<{
    shop: { plan: { partnerDevelopment: boolean } };
  }>(gql, DEV_STORE);
  return shop.plan.partnerDevelopment;
}

/** What a paid plan costs for an interval; null when the plan has no such option. */
export function priceFor(plan: PlanView, interval: Interval) {
  if (plan.isFree) return null;
  return interval === "yearly" ? plan.priceYearly : plan.priceMonthly;
}

/**
 * Creates the charge for a paid plan and returns Shopify's confirmation URL. The plan's price
 * and the trial days the shop has left are fixed into the charge now; later edits in the
 * backoffice apply to new charges only.
 */
export async function startSubscription(
  gql: AdminGraphql,
  shop: { id: string; domain: string },
  planKey: string,
  interval: Interval,
  now = new Date(),
) {
  const plan = await getPlan(planKey);
  if (!plan || !plan.visible)
    throw new BillingError("This plan isn't available.");
  const price = priceFor(plan, interval);
  if (price === null || price <= 0) {
    throw new BillingError(
      plan.isFree
        ? "This plan is free; no charge is needed."
        : "This plan has no yearly option.",
    );
  }
  const trialDays = trialDaysFor(plan, await trialDaysUsed(shop.id, now));
  const data = await gqlData<{
    appSubscriptionCreate: {
      appSubscription: { id: string } | null;
      confirmationUrl: string | null;
      userErrors: UserError[];
    };
  }>(gql, CREATE, {
    name: chargeName(plan.name, interval),
    returnUrl: returnUrl(shop.domain),
    trialDays,
    test: await isTest(gql),
    // Upgrades apply at once; Shopify defers some downgrades of annual plans itself.
    replacementBehavior: "STANDARD",
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: { amount: price, currencyCode: "USD" },
            interval: SHOPIFY_INTERVAL[interval],
          },
        },
      },
    ],
  });
  const res = data.appSubscriptionCreate;
  if (res.userErrors.length || !res.appSubscription || !res.confirmationUrl) {
    console.error("billing: appSubscriptionCreate refused", {
      shopId: shop.id,
      errors: res.userErrors,
    });
    throw new BillingError(
      "Shopify couldn't start this plan. Please try again in a moment.",
    );
  }
  await prisma.appSubscription.create({
    data: {
      shopId: shop.id,
      shopifyId: res.appSubscription.id,
      planKey: plan.key,
      interval: SHOPIFY_INTERVAL[interval],
      price,
      trialDays,
    },
  });
  return { confirmationUrl: res.confirmationUrl, trialDays };
}

/** Ends the charge `shopifyId` in our records (status from Shopify or the webhook). */
async function endRecord(shopifyId: string, status: string, now: Date) {
  await prisma.appSubscription.updateMany({
    where: { shopifyId, endedAt: null },
    data: { status, endedAt: now },
  });
}

/** Moves the shop to a free plan: cancels its active charges, then stores the plan. */
export async function switchToFree(
  gql: AdminGraphql,
  shopId: string,
  planKey: string,
  now = new Date(),
) {
  const plan = await getPlan(planKey);
  if (!plan || !plan.visible || !plan.isFree) {
    throw new BillingError("This plan isn't available.");
  }
  const { currentAppInstallation } = await gqlData<{
    currentAppInstallation: { activeSubscriptions: { id: string }[] };
  }>(gql, ACTIVE);
  for (const sub of currentAppInstallation.activeSubscriptions) {
    const data = await gqlData<{
      appSubscriptionCancel: { userErrors: UserError[] };
    }>(gql, CANCEL, { id: sub.id });
    if (data.appSubscriptionCancel.userErrors.length) {
      console.error("billing: appSubscriptionCancel refused", {
        shopId,
        errors: data.appSubscriptionCancel.userErrors,
      });
      throw new BillingError(
        "Shopify couldn't cancel your current plan. Please try again in a moment.",
      );
    }
    await endRecord(sub.id, "CANCELLED", now);
  }
  await prisma.shop.update({
    where: { id: shopId },
    data: { plan: plan.key, subscriptionId: null, trialEndsAt: null },
  });
}

interface ActiveCharge {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  lineItems: {
    plan: {
      pricingDetails: {
        __typename: string;
        interval?: string;
        price?: { amount: string | number };
      };
    };
  }[];
}

/** The charge name startSubscription gives a plan ("SpareFit Growth", "… (yearly)"). */
export const chargeName = (planName: string, interval: Interval) =>
  `SpareFit ${planName}${interval === "yearly" ? " (yearly)" : ""}`;

/** Records active charges we have no row for, when their name matches a plan. Newest first. */
async function adoptCharges(
  shopId: string,
  active: ActiveCharge[],
  plans: PlanView[],
) {
  const rows = [];
  for (const charge of active) {
    const interval: Interval = / \(yearly\)$/.test(charge.name)
      ? "yearly"
      : "monthly";
    const plan = plans.find(
      (p) => chargeName(p.name, interval) === charge.name,
    );
    if (!plan) continue;
    const pricing = charge.lineItems[0]?.plan.pricingDetails;
    rows.push(
      await prisma.appSubscription.upsert({
        where: { shopifyId: charge.id },
        create: {
          shopId,
          shopifyId: charge.id,
          planKey: plan.key,
          interval: SHOPIFY_INTERVAL[interval],
          price: Number(pricing?.price?.amount ?? 0),
          // Unknown: count the plan's trial, so the used days are never under-counted.
          trialDays: plan.trialDays,
        },
        update: {},
      }),
    );
    console.warn("billing: adopted an unrecorded charge", {
      shopId,
      id: charge.id,
      plan: plan.key,
    });
  }
  return rows
    .filter((r) => r.shopId === shopId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export interface SyncedPlan {
  plan: string;
  trialEndsAt: Date | null;
}

/**
 * Reads the shop's active charge from Shopify and stores the plan it stands for. Charges we
 * don't know (not created by this app version) count as no plan. A shop that chose a free plan
 * keeps it while it has no active charge.
 */
export async function syncSubscription(
  gql: AdminGraphql,
  shopId: string,
  now = new Date(),
  /** Checked before the plan is stored: false when a newer read has started (billing.server). */
  stillNewest: () => boolean = () => true,
): Promise<SyncedPlan | null> {
  const { currentAppInstallation } = await gqlData<{
    currentAppInstallation: { activeSubscriptions: ActiveCharge[] };
  }>(gql, ACTIVE);
  const active = currentAppInstallation.activeSubscriptions.filter(
    (s) => s.status === "ACTIVE",
  );
  const ids = active.map((s) => s.id);
  const [records, plans, shop] = await Promise.all([
    prisma.appSubscription.findMany({ where: { shopId } }),
    getPlans(),
    prisma.shop.findUniqueOrThrow({
      where: { id: shopId },
      select: { plan: true },
    }),
  ]);
  let known = records
    .filter((r) => ids.includes(r.shopifyId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (!known.length && active.length) {
    // A charge we have no record of (e.g. the insert after appSubscriptionCreate failed): map it
    // by the name we gave it, so a paying merchant never gets the fallback plan's limits.
    const adopted = await adoptCharges(shopId, active, plans);
    if (adopted.length) known = adopted;
    else {
      console.warn("billing: active charge not created by this app", {
        shopId,
        ids,
      });
    }
  }
  const current = known[0] ?? null;

  // Charges that are no longer active have ended (cancelled, replaced, expired, declined).
  const ended = records.filter(
    (r) =>
      r.endedAt === null &&
      r.activatedAt !== null &&
      !ids.includes(r.shopifyId),
  );
  for (const r of ended) await endRecord(r.shopifyId, "ENDED", now);

  let plan: string;
  let trialEndsAt: Date | null = null;
  if (current) {
    // Shopify's creation time when we first see it active (a missed webhook doesn't move the
    // trial start to our first read); never later than now.
    const shopifyCreated = new Date(
      active.find((s) => s.id === current.shopifyId)?.createdAt ?? now,
    );
    const activatedAt =
      current.activatedAt ??
      (Number.isNaN(shopifyCreated.getTime()) || shopifyCreated > now
        ? now
        : shopifyCreated);
    if (!current.activatedAt || current.status !== "ACTIVE") {
      await prisma.appSubscription.update({
        where: { id: current.id },
        data: { status: "ACTIVE", activatedAt },
      });
    }
    plan = current.planKey;
    trialEndsAt =
      current.trialDays > 0
        ? new Date(activatedAt.getTime() + current.trialDays * DAY)
        : null;
  } else {
    const stored = plans.find((p) => p.key === shop.plan);
    plan = stored?.isFree ? stored.key : "none";
  }
  if (!stillNewest()) return null;
  await prisma.shop.update({
    where: { id: shopId },
    data: { plan, trialEndsAt, subscriptionId: current?.shopifyId ?? null },
  });
  return { plan, trialEndsAt };
}

/**
 * A charge's status changed (app_subscriptions/update webhook). Records it; the plan itself is
 * re-read from Shopify by the caller when it can (an admin client is available).
 */
export async function recordStatus(
  shopId: string,
  shopifyId: string,
  status: string,
  now = new Date(),
) {
  const upper = status.toUpperCase();
  if (upper === "ACTIVE") {
    await prisma.appSubscription.updateMany({
      where: { shopId, shopifyId, activatedAt: null },
      data: { status: upper, activatedAt: now },
    });
    return;
  }
  if (["CANCELLED", "DECLINED", "EXPIRED", "FROZEN"].includes(upper)) {
    await prisma.appSubscription.updateMany({
      where: { shopId, shopifyId, endedAt: null },
      data: { status: upper, ...(upper === "FROZEN" ? {} : { endedAt: now }) },
    });
  }
}
