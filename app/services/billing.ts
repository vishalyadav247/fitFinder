// Plans and limits (specs/plans.md; prices and limits are the proposal, not final). Billing runs on
// Shopify App Pricing: plans live in the Partner Dashboard and Shopify hosts the plan page; the
// app only reads the active plan (billing.server.ts) and enforces the number limits (rows and
// linked products). The number of search fields is up to each store, on every plan (agreed
// 2026-10-06); feature limits per plan are not enforced yet. Pure.

export type PlanKey = "starter" | "growth" | "pro";

/** Stored in shops.plan: a plan, or "none" when the shop hasn't picked one (Starter limits). */
export type ShopPlan = PlanKey | "none";

export interface Limits {
  rows: number;
  products: number;
}

export interface Plan {
  key: PlanKey;
  name: string;
  /** Monthly price in USD; yearly = 10 × (two months free). */
  month: number;
  limits: Limits;
  sub: string;
  items: string[];
}

export const PLANS: Plan[] = [
  {
    key: "starter",
    name: "Starter",
    month: 0,
    limits: { rows: 5000, products: 50 },
    sub: "50 products · 5,000 rows",
    items: ["Search section and Fits badge", "CSV import with column mapping"],
  },
  {
    key: "growth",
    name: "Growth",
    month: 29,
    limits: { rows: 500_000, products: 5000 },
    sub: "5,000 products · 500,000 rows",
    items: [
      "Everything in Starter",
      "Fitment table (also inside your theme tabs)",
      "My Selection floating button",
      "Universal products",
      "Import history with 5 backups",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    month: 99,
    limits: { rows: Infinity, products: Infinity },
    sub: "Unlimited products and rows",
    items: [
      "Everything in Growth",
      "Scheduled imports from a supplier feed",
      "Search analytics",
      "Priority support",
    ],
  },
];

export const planByKey = (key: PlanKey) => PLANS.find((p) => p.key === key)!;

/** The plan whose limits apply: "none" (no plan picked yet) gets Starter's. */
export const effectivePlan = (plan: string): Plan =>
  PLANS.find((p) => p.key === plan) ?? PLANS[0];

export const limitsFor = (plan: string): Limits => effectivePlan(plan).limits;

/**
 * Maps a subscription's plan handle (set in the Partner Dashboard) to our plan. Handles are
 * expected to be the plan key, optionally followed by - or _ ("growth", "growth-yearly",
 * "pro_plan"); anything else (e.g. a usage event "product_sync") counts as Starter.
 */
export function planFromHandles(handles: string[]): PlanKey {
  const keyOf = (h: string) =>
    /^(starter|growth|pro)(?:[-_].*)?$/i.exec(h)?.[1].toLowerCase() as
      PlanKey | undefined;
  const keys = handles.map(keyOf);
  if (keys.includes("pro")) return "pro";
  if (keys.includes("growth")) return "growth";
  return "starter";
}

/** Whole days left in a trial (rounded up), 0 when over or none. */
export function trialDaysLeft(trialEndsAt: Date | null, now = new Date()) {
  if (!trialEndsAt) return 0;
  return Math.max(
    0,
    Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86_400_000),
  );
}

/** Shopify's hosted plan selection page (Shopify App Pricing). */
export function planSelectionUrl(shopDomain: string, appHandle: string) {
  const store = shopDomain.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${encodeURIComponent(store)}/charges/${encodeURIComponent(appHandle)}/pricing_plans`;
}

export interface Usage {
  rows: number;
  products: number;
}

/** Which limits the usage is over (strictly more than allowed). */
export function overLimits(usage: Usage, limits: Limits): (keyof Limits)[] {
  return (Object.keys(limits) as (keyof Limits)[]).filter(
    (k) => usage[k] > limits[k],
  );
}

export const formatLimit = (n: number) =>
  n === Infinity ? "Unlimited" : n.toLocaleString("en-US");

export const LIMIT_LABEL: Record<keyof Limits, string> = {
  rows: "filter rows",
  products: "linked products",
};

/** Message when an action would go past a limit. */
export function limitMessage(plan: string, key: keyof Limits) {
  const p = effectivePlan(plan);
  return `The ${p.name} plan allows up to ${formatLimit(p.limits[key])} ${LIMIT_LABEL[key]}. Upgrade on the Plans page to add more.`;
}
