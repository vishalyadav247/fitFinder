import { describe, expect, it } from "vitest";
import {
  effectivePlan,
  fallbackPlan,
  featureMessage,
  formatLimit,
  formatPrice,
  limitMessage,
  limitsOf,
  overLimits,
  planLines,
  planWith,
  trialDaysFor,
  trialDaysLeft,
  visiblePlans,
} from "./billing";
import {
  limitOf,
  planInputSchema,
  readLimits,
  readToggles,
} from "./plan-features";
import { formToPlanInput } from "./backoffice-form";
import { returnUrl, priceFor } from "./subscription.server";
import { TEST_PLANS, withPlan } from "../tests/plans-fixture";

const growth = TEST_PLANS[1];

describe("plans", () => {
  it("gives a shop without a plan the first free plan's limits", () => {
    expect(effectivePlan(TEST_PLANS, "none").key).toBe("starter");
    expect(effectivePlan(TEST_PLANS, "gone").key).toBe("starter");
    expect(limitsOf(effectivePlan(TEST_PLANS, "none"))).toEqual({
      rows: 5000,
      products: 50,
      searchFields: 20,
      backups: 5,
    });
    expect(limitsOf(effectivePlan(TEST_PLANS, "pro")).rows).toBe(Infinity);
  });

  it("gives nothing for free when no plan is free", () => {
    const plans = withPlan("starter", { isFree: false, priceMonthly: 9 });
    const none = fallbackPlan(plans);
    expect(none.key).toBe("none");
    expect(limitsOf(none)).toMatchObject({ rows: 0, products: 0 });
    expect(Object.values(none.toggles).some(Boolean)).toBe(false);
  });

  it("caps search fields at 20 on every plan", () => {
    expect(
      limitOf(
        { limits: { ...growth.limits, searchFields: 50 } },
        "searchFields",
      ),
    ).toBe(20);
    expect(
      limitOf(
        { limits: { ...growth.limits, searchFields: 4 } },
        "searchFields",
      ),
    ).toBe(4);
  });

  it("lists visible plans in order, keeping the shop's hidden plan", () => {
    expect(visiblePlans(TEST_PLANS).map((p) => p.key)).toEqual([
      "starter",
      "growth",
      "pro",
    ]);
    expect(visiblePlans(TEST_PLANS, "business").map((p) => p.key)).toContain(
      "business",
    );
  });

  it("finds the limits a shop is over", () => {
    const limits = limitsOf(TEST_PLANS[0]);
    expect(overLimits({ rows: 5001, products: 51 }, limits)).toEqual([
      "rows",
      "products",
    ]);
    expect(
      overLimits({ rows: 9e9, products: 9e9 }, limitsOf(TEST_PLANS[2])),
    ).toEqual([]);
  });

  it("words limits, features and prices", () => {
    expect(formatLimit(500_000)).toBe("500,000");
    expect(formatLimit(Infinity)).toBe("Unlimited");
    expect(limitMessage(TEST_PLANS[0], "rows")).toBe(
      "The Starter plan allows up to 5,000 filter rows. Upgrade on the Plans page to add more.",
    );
    expect(featureMessage(TEST_PLANS[0], "universalProducts")).toBe(
      "Universal products isn't included in the Starter plan. Upgrade on the Plans page to use it.",
    );
    expect(formatPrice(29)).toBe("$29");
    expect(formatPrice(29.5)).toBe("$29.50");
    expect(formatPrice(1990)).toBe("$1,990");
    expect(planWith(TEST_PLANS, "mySelection")?.name).toBe("Growth");
    expect(planWith(TEST_PLANS, "prioritySupport")?.name).toBe("Pro");
  });

  it("builds card lines from limits and features", () => {
    expect(planLines(TEST_PLANS[0])).toEqual([
      "50 linked products",
      "5,000 filter rows",
      "20 search fields",
      "5 import backups",
      "Fits badge",
    ]);
    expect(planLines(TEST_PLANS[2])).toContain("Unlimited filter rows");
  });

  it("counts trial days left, rounding up", () => {
    const now = new Date("2026-10-06T12:00:00Z");
    expect(trialDaysLeft(null, now)).toBe(0);
    expect(trialDaysLeft(new Date("2026-10-06T13:00:00Z"), now)).toBe(1);
    expect(trialDaysLeft(new Date("2026-10-15T12:00:00Z"), now)).toBe(9);
    expect(trialDaysLeft(new Date("2026-10-01T12:00:00Z"), now)).toBe(0);
  });

  it("takes trial days already used off a new trial", () => {
    expect(trialDaysFor(growth, 0)).toBe(14);
    expect(trialDaysFor(growth, 10)).toBe(4);
    expect(trialDaysFor(growth, 30)).toBe(0);
    expect(trialDaysFor({ ...growth, trialDays: 7 }, 0)).toBe(7);
    expect(trialDaysFor(TEST_PLANS[0], 0)).toBe(0);
  });

  it("prices a charge per interval", () => {
    expect(priceFor(growth, "monthly")).toBe(29);
    expect(priceFor(growth, "yearly")).toBe(290);
    expect(priceFor({ ...growth, priceYearly: null }, "yearly")).toBeNull();
    expect(priceFor(TEST_PLANS[0], "monthly")).toBeNull();
  });

  it("builds the URL Shopify returns to after a charge", () => {
    expect(returnUrl("cool-shop.myshopify.com", "sparefit")).toBe(
      "https://admin.shopify.com/store/cool-shop/apps/sparefit/app/plans?charge=1",
    );
  });

  it("reads stored limits and toggles defensively", () => {
    expect(readLimits({ rows: 10, products: -1, searchFields: 2.5 })).toEqual({
      rows: 10,
      products: null,
      searchFields: null,
      backups: null,
    });
    expect(readToggles({ fitsBadge: true, mySelection: "yes" })).toMatchObject({
      fitsBadge: true,
      mySelection: false,
    });
  });
});

describe("backoffice plan form", () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  const base = {
    name: "Growth",
    description: "For growing catalogs.",
    visible: "on",
    priceMonthly: "39",
    priceYearly: "",
    trialDays: "7",
    "limit.rows": "1000",
    "unlimited.products": "on",
    "limit.searchFields": "8",
    "limit.backups": "5",
    "toggle.fitsBadge": "on",
    "toggle.mySelection": "on",
    bullets: "Everything in Starter\n\n  Fast setup \n",
  };

  it("reads a paid plan", () => {
    const parsed = planInputSchema.parse(formToPlanInput(form(base)));
    expect(parsed).toMatchObject({
      name: "Growth",
      visible: true,
      isFree: false,
      priceMonthly: 39,
      priceYearly: null,
      trialDays: 7,
      limits: { rows: 1000, products: null, searchFields: 8, backups: 5 },
      bullets: ["Everything in Starter", "Fast setup"],
    });
    expect(parsed.toggles).toMatchObject({
      fitsBadge: true,
      mySelection: true,
      fitmentTable: false,
    });
  });

  it("gives a free plan no price and no trial", () => {
    const parsed = planInputSchema.parse(
      formToPlanInput(
        form({ ...base, isFree: "on", priceMonthly: "", trialDays: "" }),
      ),
    );
    expect(parsed).toMatchObject({
      isFree: true,
      priceMonthly: 0,
      priceYearly: null,
      trialDays: 0,
    });
  });

  it("refuses bad input", () => {
    const bad = (change: Record<string, string>) =>
      planInputSchema.safeParse(formToPlanInput(form({ ...base, ...change })))
        .success;
    expect(bad({ priceMonthly: "0" })).toBe(false); // paid plan at $0
    expect(bad({ priceMonthly: "-5" })).toBe(false);
    expect(bad({ trialDays: "400" })).toBe(false);
    expect(bad({ trialDays: "1.5" })).toBe(false);
    expect(bad({ name: "  " })).toBe(false);
    expect(bad({ "limit.rows": "-1" })).toBe(false);
    expect(bad({ "limit.rows": "abc" })).toBe(false);
    expect(bad({ trialDays: "0" })).toBe(true); // no trial is allowed
  });
});
