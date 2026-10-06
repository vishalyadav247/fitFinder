// Session-free webhook check (M10): app/uninstalled and compliance topics must answer even when
// the shop's offline token can't be refreshed any more.
import { describe, expect, it } from "vitest";
import { verifyWebhook, webhookHmac } from "../services/webhook-verify.server";

const SECRET = "shh";
const body = JSON.stringify({ shop_id: 1, shop_domain: "demo.myshopify.com" });

const request = (
  headers: Record<string, string>,
  payload = body,
  method = "POST",
) =>
  new Request("https://app.test/webhooks/compliance", {
    method,
    body: method === "POST" ? payload : undefined,
    headers: {
      "x-shopify-shop-domain": "demo.myshopify.com",
      "x-shopify-topic": "shop/redact",
      "x-shopify-triggered-at": "2026-10-06T12:00:00Z",
      ...headers,
    },
  });

describe("verifyWebhook", () => {
  it("accepts a correctly signed delivery and normalises the topic", async () => {
    const hook = await verifyWebhook(
      request({ "x-shopify-hmac-sha256": webhookHmac(body, SECRET) }),
      SECRET,
    );
    expect(hook).toEqual({
      shop: "demo.myshopify.com",
      topic: "SHOP_REDACT",
      triggeredAt: "2026-10-06T12:00:00Z",
      webhookId: null,
      payload: { shop_id: 1, shop_domain: "demo.myshopify.com" },
    });
  });

  it("answers 401 for a wrong or missing signature, and for a changed body", async () => {
    for (const headers of <Record<string, string>[]>[
      { "x-shopify-hmac-sha256": webhookHmac(body, "other") },
      {},
    ]) {
      await expect(
        verifyWebhook(request(headers), SECRET),
      ).rejects.toMatchObject({
        status: 401,
      });
    }
    await expect(
      verifyWebhook(
        request(
          { "x-shopify-hmac-sha256": webhookHmac(body, SECRET) },
          body + " ",
        ),
        SECRET,
      ),
    ).rejects.toMatchObject({ status: 401 });
    // No secret configured: never accept.
    await expect(
      verifyWebhook(
        request({ "x-shopify-hmac-sha256": webhookHmac(body, "") }),
        "",
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("reads headers in any case and accepts an empty body", async () => {
    const hook = await verifyWebhook(
      new Request("https://app.test/webhooks/compliance", {
        method: "POST",
        body: "",
        headers: {
          "X-Shopify-Hmac-Sha256": webhookHmac("", SECRET),
          "X-Shopify-Shop-Domain": "demo.myshopify.com",
          "X-Shopify-Topic": "customers/redact",
          "X-Shopify-Webhook-Id": "w1",
        },
      }),
      SECRET,
    );
    expect(hook).toMatchObject({
      topic: "CUSTOMERS_REDACT",
      webhookId: "w1",
      payload: null,
    });
  });

  it("answers 405 to anything but POST", async () => {
    await expect(
      verifyWebhook(request({}, body, "GET"), SECRET),
    ).rejects.toMatchObject({
      status: 405,
    });
  });
});
