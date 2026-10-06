import type { ActionFunctionArgs } from "react-router";
import { verifyWebhook } from "../services/webhook-verify.server";
import db from "../db.server";
import { getShopByDomain, markShopUninstalled } from "../models/shop.server";

// Checked without the shop's session (webhook-verify.server.ts): the library would try to
// refresh the expired offline token, which fails after an uninstall (500 on every retry).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, triggeredAt } = await verifyWebhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhooks can be retried and arrive after a reinstall. Only act when the shop wasn't
  // reinstalled after this uninstall; otherwise we'd log out a freshly installed shop.
  const when = triggeredAt ? new Date(triggeredAt) : new Date();
  const uninstalledAt = Number.isNaN(when.getTime()) ? new Date() : when;
  const marked = await markShopUninstalled(shop, uninstalledAt);
  const known = marked || (await getShopByDomain(shop)) !== null;

  // Shops installed before the shops table existed have no row: still clear their sessions.
  if (marked || !known) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
