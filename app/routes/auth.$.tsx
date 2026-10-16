import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate, login } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  // The library's login path must use login(), not authenticate.admin() (that threw a 500).
  // There is no login page with a shop field (App Store 2.3.1): with a shop, Shopify's install /
  // OAuth starts; without one, the landing page explains how to install from Shopify.
  if (url.pathname === "/auth/login") {
    const shop = url.searchParams.get("shop") ?? "";
    if (!SHOP.test(shop)) throw redirect("/");
    const result = await login(request);
    // login() throws its redirect; anything returned is a form error (bad shop): go home.
    if (result) throw redirect("/");
  }
  await authenticate.admin(request);

  return null;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
