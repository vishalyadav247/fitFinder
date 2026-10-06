// Mandatory compliance webhooks (customers/data_request, customers/redact, shop/redact).
// The signature is checked without the shop's session (webhook-verify.server.ts): 401 when the
// HMAC is wrong, as Shopify requires.
// FitFinder stores no customer data (My Selection lives in the shopper's browser), so the two
// customer topics have nothing to return or delete. shop/redact (48 hours after uninstall) is
// met by the purge at uninstall + 30 days (purge.server.ts), which is within Shopify's 30 days.
// Docs: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
import type { ActionFunctionArgs } from "react-router";
import { verifyWebhook } from "../services/webhook-verify.server";
import { markShopUninstalled } from "../models/shop.server";

/** shop/redact is sent this long after the uninstall. */
export const REDACT_DELAY_MS = 48 * 60 * 60 * 1000;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, triggeredAt, webhookId } = await verifyWebhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      console.log(`${topic} for ${shop}: no customer data stored`, {
        webhookId,
      });
      break;
    case "SHOP_REDACT": {
      // If our app/uninstalled webhook never arrived, mark the shop as uninstalled when it
      // happened (48 hours earlier), so the purge deletes it. A shop used since then (reinstalled)
      // has a later last visit and is left alone.
      const sent = triggeredAt ? new Date(triggeredAt) : new Date();
      const when = Number.isNaN(sent.getTime()) ? new Date() : sent;
      await markShopUninstalled(
        shop,
        new Date(when.getTime() - REDACT_DELAY_MS),
      );
      console.log(
        `${topic} for ${shop}: data is deleted 30 days after uninstall`,
      );
      break;
    }
    default:
      console.warn(`compliance webhook: unexpected topic ${topic}`);
  }
  return new Response();
};
