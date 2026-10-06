import { describe, expect, it } from "vitest";
import {
  effectivePlan,
  formatLimit,
  limitMessage,
  limitsFor,
  overLimits,
  planFromHandles,
  planSelectionUrl,
  trialDaysLeft,
} from "./billing";
import { fetchActiveSubscription, partnerConfig } from "./billing.server";

describe("plans", () => {
  it("maps subscription handles to plans", () => {
    expect(planFromHandles(["pro_plan"])).toBe("pro");
    expect(planFromHandles(["Growth-yearly"])).toBe("growth");
    expect(planFromHandles(["starter"])).toBe("starter");
    expect(planFromHandles(["something-else"])).toBe("starter");
    expect(planFromHandles(["product_sync"])).toBe("starter");
    expect(planFromHandles(["Pro"])).toBe("pro");
  });

  it("gives a shop without a plan Starter's limits", () => {
    expect(effectivePlan("none").key).toBe("starter");
    expect(limitsFor("none")).toEqual({ rows: 5000, products: 50 });
    expect(limitsFor("pro").rows).toBe(Infinity);
  });

  it("finds the limits a shop is over", () => {
    const limits = limitsFor("starter");
    expect(overLimits({ rows: 5001, products: 51 }, limits)).toEqual([
      "rows",
      "products",
    ]);
    expect(overLimits({ rows: 9e9, products: 9e9 }, limitsFor("pro"))).toEqual(
      [],
    );
  });

  it("words limits and refusals", () => {
    expect(formatLimit(500_000)).toBe("500,000");
    expect(formatLimit(Infinity)).toBe("Unlimited");
    expect(limitMessage("none", "rows")).toBe(
      "The Starter plan allows up to 5,000 filter rows. Upgrade on the Plans page to add more.",
    );
  });

  it("counts trial days left, rounding up", () => {
    const now = new Date("2026-10-06T12:00:00Z");
    expect(trialDaysLeft(null, now)).toBe(0);
    expect(trialDaysLeft(new Date("2026-10-06T13:00:00Z"), now)).toBe(1);
    expect(trialDaysLeft(new Date("2026-10-15T12:00:00Z"), now)).toBe(9);
    expect(trialDaysLeft(new Date("2026-10-01T12:00:00Z"), now)).toBe(0);
  });

  it("builds Shopify's plan page URL", () => {
    expect(planSelectionUrl("cool-shop.myshopify.com", "fitfinder")).toBe(
      "https://admin.shopify.com/store/cool-shop/charges/fitfinder/pricing_plans",
    );
  });
});

describe("Partner API", () => {
  const config = { orgId: "123", token: "t", appGid: "gid://shopify/App/9" };
  const reply = (status: number, body: unknown) =>
    (async () =>
      new Response(JSON.stringify(body), {
        status,
      })) as unknown as typeof fetch;

  it("needs all three credentials", () => {
    expect(partnerConfig({})).toBeNull();
    expect(
      partnerConfig({
        SHOPIFY_PARTNER_ORG_ID: "1",
        SHOPIFY_PARTNER_API_ACCESS_TOKEN: "t",
        SHOPIFY_APP_GID: "gid://shopify/App/9",
      }),
    ).toEqual({ orgId: "1", token: "t", appGid: "gid://shopify/App/9" });
  });

  it("reads the active subscription and sends the documented request", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(
        JSON.stringify({
          data: {
            activeSubscription: {
              billingPeriod: "EVERY_30_DAYS",
              trialEndsAt: "2026-10-20T00:00:00Z",
              items: [{ handle: "growth" }],
            },
          },
        }),
      );
    }) as unknown as typeof fetch;
    expect(
      await fetchActiveSubscription(config, "gid://shopify/Shop/1", fetcher),
    ).toEqual({
      handles: ["growth"],
      trialEndsAt: "2026-10-20T00:00:00Z",
      billingPeriod: "EVERY_30_DAYS",
    });
    expect(seen!.url).toBe(
      "https://partners.shopify.com/123/api/2026-07/graphql.json",
    );
    expect(
      (seen!.init.headers as Record<string, string>)["X-Shopify-Access-Token"],
    ).toBe("t");
    expect(JSON.parse(String(seen!.init.body)).variables).toEqual({
      appId: "gid://shopify/App/9",
      shopId: "gid://shopify/Shop/1",
    });
  });

  it("returns null without a subscription and throws on failures", async () => {
    expect(
      await fetchActiveSubscription(
        config,
        "s",
        reply(200, { data: { activeSubscription: null } }),
      ),
    ).toBeNull();
    await expect(
      fetchActiveSubscription(
        config,
        "s",
        reply(200, { errors: [{ message: "Throttled" }] }),
      ),
    ).rejects.toThrow("Partner API");
    await expect(
      fetchActiveSubscription(config, "s", reply(500, {})),
    ).rejects.toThrow();
  });
});
