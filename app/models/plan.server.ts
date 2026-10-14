// The plan catalogue (plans table, edited in the backoffice). Read on every limit check, so it is
// cached per process for a short while; a save clears this process's cache, other processes
// (the job worker) pick the change up within CACHE_MS.
import { Prisma, type Plan } from "@prisma/client";
import prisma from "../db.server";
import { effectivePlan } from "../services/billing";
import {
  PLAN_KEYS,
  readLimits,
  readToggles,
  type PlanInput,
  type PlanKey,
  type PlanView,
} from "../services/plan-features";

type Db = Prisma.TransactionClient | typeof prisma;

const CACHE_MS = 30_000;
let cache: { at: number; plans: PlanView[] } | null = null;

// Tests set their own catalogue (per process), so they never edit the shared plans table.
let testPlans: PlanView[] | undefined;

export function clearPlansCache() {
  cache = null;
}

export function setPlansForTests(plans: PlanView[] | undefined) {
  testPlans = plans;
  cache = null;
}

export class PlanRuleError extends Error {}

export function toPlanView(p: Plan): PlanView {
  return {
    key: p.key as PlanKey,
    position: p.position,
    name: p.name,
    description: p.description,
    isFree: p.isFree,
    priceMonthly: Number(p.priceMonthly),
    priceYearly: p.priceYearly === null ? null : Number(p.priceYearly),
    trialDays: p.isFree ? 0 : p.trialDays,
    visible: p.visible,
    limits: readLimits(p.limits),
    toggles: readToggles(p.toggles),
    bullets: p.bullets,
  };
}

/** All plans in order (cached). Inside a transaction, read through `db` without the cache. */
export async function getPlans(db?: Db, now = Date.now()): Promise<PlanView[]> {
  if (testPlans) return testPlans;
  if (db) {
    const rows = await db.plan.findMany({ orderBy: { position: "asc" } });
    return rows.map(toPlanView);
  }
  if (cache && now - cache.at < CACHE_MS) return cache.plans;
  const rows = await prisma.plan.findMany({ orderBy: { position: "asc" } });
  const plans = rows.map(toPlanView);
  if (!plans.length)
    throw new Error("The plans table is empty (run the migrations).");
  cache = { at: now, plans };
  return plans;
}

export async function getPlan(key: string, db?: Db) {
  return (await getPlans(db)).find((p) => p.key === key) ?? null;
}

/** The plan whose limits and features apply to a shop (its stored plan, else the fallback). */
export async function shopPlanView(shopId: string, db?: Db): Promise<PlanView> {
  const [shop, plans] = await Promise.all([
    (db ?? prisma).shop.findUnique({
      where: { id: shopId },
      select: { plan: true },
    }),
    getPlans(db),
  ]);
  return effectivePlan(plans, shop?.plan ?? "none");
}

/** Saves one plan from the backoffice. At least one plan must stay visible. */
export async function updatePlan(key: string, input: PlanInput, by: string) {
  if (!(PLAN_KEYS as readonly string[]).includes(key)) {
    throw new PlanRuleError("This plan doesn't exist.");
  }
  await prisma.$transaction(async (tx) => {
    // One save at a time, so the "one visible plan" check can't be raced.
    await tx.$executeRaw`SELECT 1 FROM plans FOR UPDATE`;
    if (!input.visible) {
      const others = await tx.plan.count({
        where: { visible: true, key: { not: key } },
      });
      if (others === 0) {
        throw new PlanRuleError(
          "At least one plan must be shown to merchants.",
        );
      }
    }
    await tx.plan.update({
      where: { key },
      data: {
        name: input.name,
        description: input.description,
        visible: input.visible,
        isFree: input.isFree,
        priceMonthly: new Prisma.Decimal(input.priceMonthly),
        priceYearly:
          input.priceYearly === null
            ? null
            : new Prisma.Decimal(input.priceYearly),
        trialDays: input.trialDays,
        limits: input.limits,
        toggles: input.toggles,
        bullets: input.bullets,
        updatedBy: by,
      },
    });
  });
  clearPlansCache();
}

/** Shops per plan with an active subscription, and shops on the fallback (backoffice list). */
export async function subscriberCounts() {
  const rows = await prisma.shop.groupBy({
    by: ["plan"],
    where: { uninstalledAt: null },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.plan, r._count._all])) as Record<
    string,
    number
  >;
}
