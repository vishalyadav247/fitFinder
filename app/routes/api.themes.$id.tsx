// GET /api/themes/{id} — what FitFinder has in one of the shop's themes (app embed on, blocks
// added, [fitfinder-table] code found). The Storefront page calls it when the merchant picks a
// theme and when they come back from the theme editor (window focus).
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import {
  readThemeStatus,
  ThemeNotFoundError,
} from "../services/storefront/themes.server";

const THEME_ID = /^\d{1,20}$/;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const themeId = params.id ?? "";
  if (!THEME_ID.test(themeId)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const shop = await ensureShop(session.shop);
  try {
    const status = await readThemeStatus(admin.graphql, shop.id, themeId);
    return Response.json({ status });
  } catch (error) {
    if (error instanceof ThemeNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    console.error("themes: status read failed", {
      shop: session.shop,
      themeId,
      error,
    });
    return Response.json(
      { error: "Couldn't read that theme. Try again." },
      { status: 502 },
    );
  }
};
