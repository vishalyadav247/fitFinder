// app_subscriptions/update: a charge was approved, declined, cancelled, frozen or expired. The
// status is recorded on our copy of the charge, then the shop's plan is re-read from the Admin
// API (subscription.server.ts) so limits change without the merchant opening the app.
// Checked without the shop's session (webhook-verify.server.ts): Shopify sends CANCELLED on
// uninstall, and the library's token refresh would then fail and answer 500 on every retry.
// Docs: https://shopify.dev/docs/api/admin-graphql/2026-10/enums/WebhookSubscriptionTopic (APP_SUBSCRIPTIONS_UPDATE)
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { unauthenticated } from "../shopify.server";
import { verifyWebhook } from "../services/webhook-verify.server";
import prisma from "../db.server";
import { recordStatus } from "../services/subscription.server";
import { shopPlan } from "../services/billing.server";
import { publishStorefrontConfig } from "../services/storefront/sync.server";

const Payload = z.object({
  app_subscription: z.object({
    admin_graphql_api_id: z.string(),
    status: z.string(),
  }),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop } = await verifyWebhook(request);
  const parsed = Payload.safeParse(payload);
  if (!parsed.success) {
    console.error("app_subscriptions/update: unexpected payload", { shop });
    return new Response();
  }
  const { admin_graphql_api_id: id, status } = parsed.data.app_subscription;
  const known = await prisma.shop.findUnique({
    where: { domain: shop },
    select: { id: true, uninstalledAt: true },
  });
  if (!known) return new Response();
  await recordStatus(known.id, id, status);

  if (known.uninstalledAt) return new Response();
  // No working admin client (session gone, token refresh refused): the status is recorded and
  // the next admin visit re-reads the plan.
  let graphql;
  try {
    graphql = (await unauthenticated.admin(shop)).admin.graphql;
  } catch (error) {
    console.error("app_subscriptions/update: no admin session", {
      shop,
      error,
    });
    return new Response();
  }
  try {
    await shopPlan(graphql, known.id, { force: true, bypassThrottle: true });
    // The plan gates storefront features (badge, table, My Selection) through the config:
    // publish it now, not only on the merchant's next admin visit.
    await publishStorefrontConfig(graphql, known.id);
  } catch (error) {
    console.error("app_subscriptions/update: plan refresh failed", {
      shop,
      error,
    });
  }
  return new Response();
};
