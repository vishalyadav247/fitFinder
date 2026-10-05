// GET /api/links/status: the shop's link check state. Product mapping polls this (cheap) while a
// check runs and reloads its lists only when the check has ended.
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { linkCheckState } from "../services/linking/link-runs.server";
import { runPendingCheck } from "../services/jobs.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  let state = await linkCheckState(shop.id);
  // A run that died (swept as failed) still owes the check asked for meanwhile.
  if (state.status === "failed" || state.status === "completed") {
    await runPendingCheck(shop.id).catch((error) =>
      console.error("links status: couldn't queue the requested check", {
        shop: session.shop,
        error,
      }),
    );
    state = await linkCheckState(shop.id);
  }
  return Response.json(state);
};
