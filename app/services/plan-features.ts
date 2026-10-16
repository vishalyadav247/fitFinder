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
  "importBackups",
  "customCss",
] as const;
export type ToggleKey = (typeof TOGGLE_KEYS)[number];

/**
 * Limits that are always a number from 0 to their cap (agreed 2026-10-16): no "Unlimited", and no
 * plan can set more. The cap is also the most import files kept in storage.
 */
export const HARD_LIMITS: Partial<Record<LimitKey, number>> = {
  searchFields: 10,
  backups: 10,
};
/** The lowest value of a capped limit (0 when not listed). Backups are switched off as a feature. */
const MIN_LIMITS: Partial<Record<LimitKey, number>> = { backups: 1 };

/**
 * A feature missing from a stored plan: off, except import backups, which every plan had before it
 * became a switch (2026-10-16).
 */
const TOGGLE_DEFAULTS: Partial<Record<ToggleKey, boolean>> = {
  importBackups: true,
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
    help: "Dropdowns in the search. 0 to 10.",
  },
  backups: {
    label: "Import backups",
    unit: "import backups",
    help: "Downloadable import files, 1 to 10.",
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
  importBackups: {
    label: "Import backups",
    help: "Set in Limits.",
  },
  customCss: {
    label: "Custom CSS",
    help: "The merchant's own CSS for SpareFit's storefront parts (Settings).",
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

/** A capped limit: a whole number from its minimum to the cap, never unlimited. */
const capped = (min: number, cap: number) => {
  const message = `Enter a number from ${min} to ${cap}.`;
  return z.coerce
    .number({ message })
    .int(message)
    .min(min, message)
    .max(cap, message);
};

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
      Object.fromEntries(
        LIMIT_KEYS.map((k) => {
          const cap = HARD_LIMITS[k];
          return [
            k,
            cap === undefined ? limit : capped(MIN_LIMITS[k] ?? 0, cap),
          ];
        }),
      ) as Record<LimitKey, typeof limit>,
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

/**
 * A stored limits/toggles JSON value read defensively (missing keys: unlimited / off). A capped
 * limit is never above its cap; stored as unlimited (before the caps) it reads as the cap.
 */
export function readLimits(value: unknown): PlanLimits {
  const v = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return Object.fromEntries(
    LIMIT_KEYS.map((k) => {
      const n = v[k];
      const ok = typeof n === "number" && Number.isInteger(n) && n >= 0;
      const cap = HARD_LIMITS[k];
      if (cap !== undefined) {
        const min = MIN_LIMITS[k] ?? 0;
        return [k, ok ? Math.max(min, Math.min(n, cap)) : cap];
      }
      return [k, ok ? n : null];
    }),
  ) as PlanLimits;
}

export function readToggles(value: unknown): PlanToggles {
  const v = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return Object.fromEntries(
    TOGGLE_KEYS.map((k) => [
      k,
      typeof v[k] === "boolean" ? v[k] : (TOGGLE_DEFAULTS[k] ?? false),
    ]),
  ) as PlanToggles;
}

/** The limit that applies: the plan's, never above the technical cap; Infinity when unlimited. */
export function limitOf(plan: Pick<PlanView, "limits">, key: LimitKey): number {
  const n = plan.limits[key];
  const hard = HARD_LIMITS[key] ?? Infinity;
  return n === null ? hard : Math.min(n, hard);
}

/** Imported files a plan lets the merchant download: 0 without the Import backups feature. */
export function backupsOf(plan: Pick<PlanView, "limits" | "toggles">): number {
  return plan.toggles.importBackups ? limitOf(plan, "backups") : 0;
}
