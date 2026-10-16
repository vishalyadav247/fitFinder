// The seeded plans (migration 20261013120000_plans_backoffice) as PlanView[], for tests.
import type { PlanView } from "../services/plan-features";

const all = {
  fitsBadge: true,
  fitmentTable: true,
  mySelection: true,
  universalProducts: true,
  importBackups: true,
  customCss: true,
};

export const TEST_PLANS: PlanView[] = [
  {
    key: "starter",
    position: 1,
    name: "Starter",
    description: "For trying SpareFit on a small catalog.",
    isFree: true,
    priceMonthly: 0,
    priceYearly: null,
    trialDays: 0,
    visible: true,
    limits: { rows: 5000, products: 50, searchFields: null, backups: 5 },
    toggles: {
      fitsBadge: true,
      fitmentTable: false,
      mySelection: false,
      universalProducts: false,
      importBackups: true,
      customCss: false,
    },
    bullets: ["Search section", "CSV import with column mapping"],
  },
  {
    key: "growth",
    position: 2,
    name: "Growth",
    description: "For growing catalogs.",
    isFree: false,
    priceMonthly: 29,
    priceYearly: 290,
    trialDays: 14,
    visible: true,
    limits: { rows: 500_000, products: 5000, searchFields: null, backups: 5 },
    toggles: all,
    bullets: ["Everything in Starter"],
  },
  {
    key: "pro",
    position: 3,
    name: "Pro",
    description: "For large catalogs.",
    isFree: false,
    priceMonthly: 99,
    priceYearly: 990,
    trialDays: 14,
    visible: true,
    limits: { rows: null, products: null, searchFields: null, backups: 5 },
    toggles: all,
    bullets: ["Everything in Growth"],
  },
  {
    key: "business",
    position: 4,
    name: "Business",
    description: "For the largest catalogs.",
    isFree: false,
    priceMonthly: 199,
    priceYearly: 1990,
    trialDays: 14,
    visible: false,
    limits: { rows: null, products: null, searchFields: null, backups: 20 },
    toggles: all,
    bullets: ["Everything in Pro"],
  },
];

/** A copy of the plans with one plan changed. */
export const withPlan = (key: string, change: Partial<PlanView>) =>
  TEST_PLANS.map((p) => (p.key === key ? { ...p, ...change } : p));
