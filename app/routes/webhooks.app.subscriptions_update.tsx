// app_subscriptions/update: a charge was approved, declined, cancelled, frozen or expired. The
// status is recorded on our copy of the charge, then the shop's plan is re-read from the Admin
// API (subscription.server.ts) so limits change without the merchant opening the app.
// Docs: https://shopify.dev/docs/api/admin-graphql/2026-10/enums/WebhookSubscriptionTopic (APP_SUBSCRIPTIONS_UPDATE)
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { authenticate } from "../shopify.server";
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
  const { payload, admin, shop } = await authenticate.webhook(request);
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

  // No admin client (the session is gone, e.g. uninstalled): the next admin visit re-reads it.
  if (!known.uninstalledAt && admin) {
    await shopPlan(admin.graphql, known.id, {
      force: true,
      bypassThrottle: true,
    });
    // The plan gates storefront features (badge, table, My Selection) through the config:
    // publish it now, not only on the merchant's next admin visit.
    try {
      await publishStorefrontConfig(admin.graphql, known.id);
    } catch (error) {
      console.error("app_subscriptions/update: publish failed", {
        shop,
        error,
      });
    }
  }
  return new Response();
};
