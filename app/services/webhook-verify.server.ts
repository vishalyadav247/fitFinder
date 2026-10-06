// Webhook check without the shop's session, for app/uninstalled and the compliance topics.
// The library's authenticate.webhook also loads the shop's offline session and refreshes it when
// it has expired; after an uninstall that refresh fails and the handler would answer 500 on every
// retry, so Shopify never gets its 2xx and the shop is never purged. Here only the signature is
// checked: HMAC-SHA256 of the raw body with the app secret, base64, compared in constant time.
// Docs: https://shopify.dev/docs/apps/build/webhooks/verify-deliveries
import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifiedWebhook {
  shop: string;
  /** Like the library: "shop/redact" → "SHOP_REDACT". */
  topic: string;
  triggeredAt: string | null;
  /** For tracing retries in the logs. */
  webhookId: string | null;
  payload: unknown;
}

export const webhookHmac = (body: string | Buffer, secret: string) =>
  createHmac("sha256", secret).update(body).digest("base64");

let warned = false;

export async function verifyWebhook(
  request: Request,
  secret = process.env.SHOPIFY_API_SECRET ?? "",
): Promise<VerifiedWebhook> {
  if (request.method !== "POST") throw new Response(null, { status: 405 });
  if (!secret && !warned) {
    warned = true;
    console.error(
      "webhooks: SHOPIFY_API_SECRET is not set; every webhook gets 401",
    );
  }
  // Signed over the exact bytes Shopify sent.
  const raw = Buffer.from(await request.arrayBuffer());
  const given = request.headers.get("x-shopify-hmac-sha256") ?? "";
  const expected = webhookHmac(raw, secret);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Response(null, { status: 401 });
  }
  const shop = request.headers.get("x-shopify-shop-domain") ?? "";
  const topic = (request.headers.get("x-shopify-topic") ?? "")
    .toUpperCase()
    .replace(/[/.]/g, "_");
  if (!shop || !topic) throw new Response(null, { status: 400 });
  let payload: unknown = null;
  try {
    payload = raw.length ? JSON.parse(raw.toString("utf8")) : null;
  } catch {
    throw new Response(null, { status: 400 });
  }
  return {
    shop,
    topic,
    triggeredAt: request.headers.get("x-shopify-triggered-at"),
    webhookId: request.headers.get("x-shopify-webhook-id"),
    payload,
  };
}
