// Plans and limits (specs/plans.md). The plans live in the plans table and are edited in the
// backoffice (specs/backoffice.md); loaders send them as PlanView[] and these helpers work on that
// list. Billing runs on the Billing API (billing.server.ts, subscription.server.ts): the app creates
// the charge with the plan's price and trial. Pure.
import {
  LIMITS,
  backupsOf,
  limitOf,
  TOGGLES,
  type LimitKey,
  type PlanView,
  type ToggleKey,
} from "./plan-features";

export type { PlanKey, PlanView, LimitKey, ToggleKey } from "./plan-features";

/** Stored in shops.plan: a plan key, or "none" when the shop has no plan yet. */
export type ShopPlan = string;

/** The limits that apply, unlimited as Infinity. */
export type Limits = Record<LimitKey, number>;

const byPosition = (plans: PlanView[]) =>
  [...plans].sort((a, b) => a.position - b.position);

/**
 * What a shop without a plan gets when no plan is free: no rows, products or features until it
 * picks a plan (with its trial). Never a paid plan's limits for free.
 */
export const NO_PLAN: PlanView = {
  key: "none" as PlanView["key"],
  position: 0,
  name: "No plan",
  description: "",
  isFree: true,
  priceMonthly: 0,
  priceYearly: null,
  trialDays: 0,
  visible: false,
  limits: { rows: 0, products: 0, searchFields: 0, backups: 1 },
  toggles: {
    fitsBadge: false,
    fitmentTable: false,
    mySelection: false,
    universalProducts: false,
    importBackups: false,
    customCss: false,
  },
  bullets: [],
};

/**
 * The plan of a shop without a subscription: the first free plan (visible ones first). Its
 * limits apply until the shop picks a plan. Without a free plan: NO_PLAN.
 */
export function fallbackPlan(plans: PlanView[]): PlanView {
  const free = byPosition(plans).filter((p) => p.isFree);
  return free.find((p) => p.visible) ?? free[0] ?? NO_PLAN;
}

/** The plan whose limits apply; an unknown key or "none" gets the fallback plan. */
export const effectivePlan = (plans: PlanView[], plan: string): PlanView =>
  plans.find((p) => p.key === plan) ?? fallbackPlan(plans);

export const limitsOf = (plan: PlanView): Limits => ({
  rows: limitOf(plan, "rows"),
  products: limitOf(plan, "products"),
  searchFields: limitOf(plan, "searchFields"),
  backups: backupsOf(plan),
});

/** Plans shown to merchants, in order. The shop's own plan stays listed even when hidden. */
export const visiblePlans = (plans: PlanView[], current?: string) =>
  byPosition(plans).filter((p) => p.visible || p.key === current);

/** Whole days left in a trial (rounded up), 0 when over or none. */
export function trialDaysLeft(trialEndsAt: Date | null, now = new Date()) {
  if (!trialEndsAt) return 0;
  return Math.max(
    0,
    Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86_400_000),
  );
}

/**
 * Trial days a new subscription gets: the plan's trial minus the days the shop has already been
 * on a trial (any plan, also before a reinstall), so reinstalling doesn't start a new trial.
 */
export const trialDaysFor = (plan: PlanView, usedDays: number) =>
  plan.isFree ? 0 : Math.max(0, plan.trialDays - Math.max(0, usedDays));

export interface Usage {
  rows: number;
  products: number;
  /** Optional: only the dashboard counts fields. */
  searchFields?: number;
}

/** Which of the usage's limits it is over (strictly more than allowed). */
export function overLimits(usage: Usage, limits: Limits): (keyof Usage)[] {
  return (Object.keys(usage) as (keyof Usage)[]).filter(
    (k) => (usage[k] ?? 0) > limits[k],
  );
}

export const formatLimit = (n: number) =>
  n === Infinity ? "Unlimited" : n.toLocaleString("en-US");

export const LIMIT_LABEL = Object.fromEntries(
  Object.entries(LIMITS).map(([k, v]) => [k, v.unit]),
) as Record<LimitKey, string>;

/** Message when an action would go past a limit. */
export function limitMessage(plan: PlanView, key: LimitKey) {
  return `The ${plan.name} plan allows up to ${formatLimit(limitOf(plan, key))} ${LIMIT_LABEL[key]}. Upgrade on the Plans page to add more.`;
}

/** Message when the plan doesn't include a feature. */
export function featureMessage(plan: PlanView, key: ToggleKey) {
  return `${TOGGLES[key].label} isn't included in the ${plan.name} plan. Upgrade on the Plans page to use it.`;
}

/** The cheapest visible plan that includes a feature (for "Needs {plan}" hints), or null. */
export function planWith(plans: PlanView[], key: ToggleKey): PlanView | null {
  return byPosition(plans).find((p) => p.visible && p.toggles[key]) ?? null;
}

/** A card's generated lines: its limits, then the features it includes. */
export function planLines(plan: PlanView): string[] {
  const n = (key: LimitKey) => {
    const v = limitOf(plan, key);
    return v === Infinity
      ? `Unlimited ${LIMIT_LABEL[key]}`
      : `${formatLimit(v)} ${LIMIT_LABEL[key]}`;
  };
  return [
    n("products"),
    n("rows"),
    n("searchFields"),
    // Import backups is a feature with a count: one line, "5 import backups", when it's on.
    ...(plan.toggles.importBackups ? [n("backups")] : []),
    ...(Object.keys(TOGGLES) as ToggleKey[])
      .filter((k) => plan.toggles[k] && k !== "importBackups")
      .map((k) => TOGGLES[k].label),
  ];
}

/** "$29" / "$29.50" */
export const formatPrice = (n: number) =>
  "$" +
  n.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
