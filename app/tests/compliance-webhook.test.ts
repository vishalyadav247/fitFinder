// Compliance webhooks (M10): answer 200 for every mandatory topic; shop/redact marks the shop
// uninstalled as of 48 hours earlier (the purge deletes it 30 days after uninstall).
import { beforeEach, describe, expect, it, vi } from "vitest";

const webhook = vi.fn();
const markShopUninstalled = vi.fn();

vi.mock("../db.server", () => ({ default: {} }));
vi.mock("../services/webhook-verify.server", () => ({
  verifyWebhook: (r: Request) => webhook(r),
}));
vi.mock("../models/shop.server", () => ({ markShopUninstalled }));

const { action, REDACT_DELAY_MS } =
  await import("../routes/webhooks.compliance");

const call = () =>
  action({
    request: new Request("https://app.test/webhooks/compliance", {
      method: "POST",
    }),
    params: {},
    context: {},
  } as never) as Promise<Response>;

beforeEach(() => {
  webhook.mockReset();
  markShopUninstalled.mockReset();
});

describe("compliance webhooks", () => {
  it("answers 200 to the customer topics without touching data", async () => {
    for (const topic of ["CUSTOMERS_DATA_REQUEST", "CUSTOMERS_REDACT"]) {
      webhook.mockResolvedValue({ shop: "demo.myshopify.com", topic });
      expect((await call()).status).toBe(200);
    }
    expect(markShopUninstalled).not.toHaveBeenCalled();
  });

  it("marks the shop uninstalled as of 48 hours before shop/redact", async () => {
    webhook.mockResolvedValue({
      shop: "demo.myshopify.com",
      topic: "SHOP_REDACT",
      triggeredAt: "2026-10-06T12:00:00Z",
    });
    expect((await call()).status).toBe(200);
    const [shop, when] = markShopUninstalled.mock.calls[0];
    expect(shop).toBe("demo.myshopify.com");
    expect((when as Date).getTime()).toBe(
      Date.parse("2026-10-06T12:00:00Z") - REDACT_DELAY_MS,
    );
  });

  it("passes on the 401 for a bad HMAC", async () => {
    webhook.mockRejectedValue(new Response(null, { status: 401 }));
    await expect(call()).rejects.toMatchObject({ status: 401 });
  });
});
