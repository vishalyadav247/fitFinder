import { beforeEach, describe, expect, it, vi } from "vitest";

const applyStoreType = vi.fn();
const getSearchConfig = vi.fn();

vi.mock("../db.server", () => ({ default: {} }));
vi.mock("../shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => ({
      session: { shop: "demo.myshopify.com" },
      admin: { graphql: vi.fn() },
      redirect: (url: string) =>
        new Response(null, { status: 302, headers: { Location: url } }),
    })),
  },
}));
vi.mock("../models/shop.server", () => ({
  ensureShop: vi.fn(async () => ({ id: "shop_1" })),
}));
vi.mock("../services/billing.server", () => ({
  shopPlan: vi.fn(async () => ({})),
}));
vi.mock("../services/storefront/sync.server", () => ({
  publishStorefrontConfig: vi.fn(async () => false),
}));
vi.mock("../models/search-config.server", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../models/search-config.server")>();
  return {
    ...real,
    applyStoreType,
    getSearchConfig,
    getSetupCounts: vi.fn(),
  };
});

const { action } = await import("../routes/app.onboarding");
const { loader: layoutLoader } = await import("../routes/app");
const { SetupExistsError } = await import("../models/search-config.server");

function post(body: Record<string, string>) {
  const request = new Request("https://app.test/app/onboarding", {
    method: "POST",
    body: new URLSearchParams(body),
  });
  return action({ request, params: {}, context: {} } as never);
}

/** data() results are objects with { data, init }; responses are Response. */
function statusOf(result: unknown): number {
  if (result instanceof Response) return result.status;
  return (result as { init?: { status?: number } }).init?.status ?? 200;
}

beforeEach(() => {
  applyStoreType.mockReset();
  getSearchConfig.mockReset();
});

describe("onboarding action", () => {
  it("rejects bad input with 400 and changes nothing", async () => {
    const result = await post({ storeType: "cars", replace: "false" });
    expect(statusOf(result)).toBe(400);
    expect(applyStoreType).not.toHaveBeenCalled();
  });

  it("returns 409 when the shop is already set up and replace wasn't confirmed", async () => {
    applyStoreType.mockRejectedValue(new SetupExistsError());
    const result = await post({ storeType: "phones", replace: "false" });
    expect(statusOf(result)).toBe(409);
  });

  it("returns 500 with a toast message on unexpected errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    applyStoreType.mockRejectedValue(new Error("db down"));
    const result = await post({ storeType: "phones", replace: "true" });
    expect(statusOf(result)).toBe(500);
  });

  it("applies the type for the session's shop and redirects to the dashboard", async () => {
    const result = await post({ storeType: "beauty", replace: "true" });
    expect(applyStoreType).toHaveBeenCalledWith("shop_1", "beauty", {
      replace: true,
    });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("Location")).toBe("/app");
  });
});

describe("app layout loader", () => {
  const load = (path: string) =>
    layoutLoader({
      request: new Request(`https://app.test${path}`),
      params: {},
      context: {},
    } as never);

  it("sends a shop without a store type to onboarding", async () => {
    getSearchConfig.mockResolvedValue(null);
    const thrown = await load("/app").catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("Location")).toBe(
      "/app/onboarding",
    );
  });

  it("doesn't redirect on the onboarding page itself", async () => {
    getSearchConfig.mockResolvedValue(null);
    await expect(load("/app/onboarding")).resolves.toHaveProperty("apiKey");
  });

  it("lets a set-up shop through", async () => {
    getSearchConfig.mockResolvedValue({ storeType: "automotive" });
    await expect(load("/app/search-setup")).resolves.toHaveProperty("apiKey");
  });
});
