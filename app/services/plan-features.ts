// The plan catalogue's shape: which limits and features a plan can set. The values per plan live
// in the plans table and are edited in the backoffice (specs/backoffice.md); this registry lists
// what the code enforces, so a new feature needs code here and where it is checked. Pure.
import { z } from "zod";

/** The four plan slots; names, prices and features are edited in the backoffice. */
export const PLAN_KEYS = ["starter", "growth", "pro", "business"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export const LIMIT_KEYS = [
  "rows",
  "products",
  "searchFields",
  "backups",
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export const TOGGLE_KEYS = [
  "fitsBadge",
  "fitmentTable",
  "mySelection",
  "universalProducts",
  "prioritySupport",
] as const;
export type ToggleKey = (typeof TOGGLE_KEYS)[number];

/** Technical caps that no plan can raise. */
export const HARD_LIMITS: Partial<Record<LimitKey, number>> = {
  searchFields: 20,
  // "Unlimited" backups still keep the files of 100 imports at most (storage).
  backups: 100,
};

export const LIMITS: Record<
  LimitKey,
  { label: string; unit: string; help: string }
> = {
  rows: {
    label: "Filter rows",
    unit: "filter rows",
    help: "Rows in Filter data (added, imported or edited).",
  },
  products: {
    label: "Linked products",
    unit: "linked products",
    help: "Products linked to filter rows, plus universal products.",
  },
  searchFields: {
    label: "Search fields",
    unit: "search fields",
    help: "Dropdowns in the search. Never more than 20.",
  },
  backups: {
    label: "Import backups",
    unit: "import backups",
    help: "Finished imports whose file and report are kept for download.",
  },
};

export const TOGGLES: Record<ToggleKey, { label: string; help: string }> = {
  fitsBadge: {
    label: "Fits badge",
    help: "Shows on product pages whether the product fits the shopper's selection.",
  },
  fitmentTable: {
    label: "Fitment table",
    help: "Product page table, also inside the theme's tabs.",
  },
  mySelection: {
    label: "My Selection floating button",
    help: "Shoppers save their selections and switch between them.",
  },
  universalProducts: {
    label: "Universal products",
    help: "Products that fit every selection.",
  },
  prioritySupport: {
    label: "Priority support",
    help: "Shown on the plan card only.",
  },
};

/** A limit: a whole number, or null for unlimited. */
export type PlanLimits = Record<LimitKey, number | null>;
export type PlanToggles = Record<ToggleKey, boolean>;

/** A plan as loaders send it (JSON-safe: unlimited is null, prices are numbers). */
export interface PlanView {
  key: PlanKey;
  position: number;
  name: string;
  description: string;
  isFree: boolean;
  priceMonthly: number;
  /** Null: no yearly option. */
  priceYearly: number | null;
  /** Free days before the first charge; always 0 on a free plan. */
  trialDays: number;
  visible: boolean;
  limits: PlanLimits;
  toggles: PlanToggles;
  bullets: string[];
}

export const MAX_TRIAL_DAYS = 365;
export const MAX_BULLETS = 12;

const money = z.coerce
  .number({ message: "Enter a price." })
  .finite()
  .min(0, "The price can't be negative.")
  .max(100_000, "The price is too high.")
  .transform((n) => Math.round(n * 100) / 100);

const limit = z.union([
  z.null(),
  z.coerce
    .number({ message: "Enter a whole number." })
    .int("Enter a whole number.")
    .min(0, "A limit can't be negative.")
    .max(1_000_000_000, "The limit is too high."),
]);

/** What the backoffice saves for one plan. Free plans get no price and no trial. */
export const planInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Enter a name.")
      .max(40, "Use 40 characters or fewer."),
    description: z.string().trim().max(160, "Use 160 characters or fewer."),
    visible: z.boolean(),
    isFree: z.boolean(),
    priceMonthly: money,
    priceYearly: money.nullable(),
    trialDays: z.coerce
      .number({ message: "Enter the number of trial days." })
      .int("Enter a whole number of days.")
      .min(0, "Trial days can't be negative.")
      .max(MAX_TRIAL_DAYS, `Use ${MAX_TRIAL_DAYS} days or fewer.`),
    limits: z.object(
      Object.fromEntries(LIMIT_KEYS.map((k) => [k, limit])) as Record<
        LimitKey,
        typeof limit
      >,
    ),
    toggles: z.object(
      Object.fromEntries(TOGGLE_KEYS.map((k) => [k, z.boolean()])) as Record<
        ToggleKey,
        z.ZodBoolean
      >,
    ),
    bullets: z
      .array(z.string().trim().max(120, "Keep each line to 120 characters."))
      .transform((list) => list.filter(Boolean))
      .pipe(
        z
          .array(z.string())
          .max(MAX_BULLETS, `Use ${MAX_BULLETS} lines or fewer.`),
      ),
  })
  .superRefine((p, ctx) => {
    if (!p.isFree && p.priceYearly !== null && p.priceYearly <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["priceYearly"],
        message:
          "Enter a yearly price above 0, or leave it empty for monthly only.",
      });
    }
    if (!p.isFree && p.priceMonthly <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["priceMonthly"],
        message:
          "A paid plan needs a monthly price above 0, or mark it as free.",
      });
    }
  })
  .transform((p) =>
    p.isFree ? { ...p, priceMonthly: 0, priceYearly: null, trialDays: 0 } : p,
  );

export type PlanInput = z.output<typeof planInputSchema>;

/** A stored limits/toggles JSON value read defensively (missing keys: unlimited / off). */
export function readLimits(value: unknown): PlanLimits {
  const v = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return Object.fromEntries(
    LIMIT_KEYS.map((k) => {
      const n = v[k];
      return [
        k,
        typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null,
      ];
    }),
  ) as PlanLimits;
}

export function readToggles(value: unknown): PlanToggles {
  const v = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return Object.fromEntries(
    TOGGLE_KEYS.map((k) => [k, v[k] === true]),
  ) as PlanToggles;
}

/** The limit that applies: the plan's, never above the technical cap; Infinity when unlimited. */
export function limitOf(plan: Pick<PlanView, "limits">, key: LimitKey): number {
  const n = plan.limits[key];
  const hard = HARD_LIMITS[key] ?? Infinity;
  return n === null ? hard : Math.min(n, hard);
}
