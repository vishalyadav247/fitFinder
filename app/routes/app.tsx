import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Outlet,
  useLoaderData,
  useLocation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { getSearchConfig } from "../models/search-config.server";

const ONBOARDING = "/app/onboarding";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  // afterAuth only runs when a new session is stored; this covers shops whose session predates it.
  const shop = await ensureShop(session.shop);

  // A shop without a store type goes to onboarding first (specs/onboarding.md).
  const onOnboarding = new URL(request.url).pathname === ONBOARDING;
  if (!onOnboarding && !(await getSearchConfig(shop.id))) {
    throw redirect(ONBOARDING);
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

const homeRel = { rel: "home" } as Record<string, string>;

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  // No sidebar menu while onboarding (specs/onboarding.md).
  const showNav = useLocation().pathname !== ONBOARDING;

  // Same items and order as the prototype (.claude/design/scripts/core/navigation.js).
  // rel="home" is hidden from the menu: the app name in the sidebar opens the Dashboard.
  return (
    <AppProvider apiKey={apiKey}>
      {showNav && (
        <s-app-nav>
          {/* Documented App Bridge markup. polaris-types' s-link has no `rel`; app-bridge-types defines it for app-nav links. */}
          <s-link href="/app" {...homeRel}>
            Dashboard
          </s-link>
          <s-link href="/app/search-setup">Search setup</s-link>
          <s-link href="/app/filter-data">Filter data</s-link>
          <s-link href="/app/storefront">Storefront</s-link>
          <s-link href="/app/product-mapping">Product mapping</s-link>
          <s-link href="/app/settings">Settings</s-link>
          <s-link href="/app/plans">Plans</s-link>
        </s-app-nav>
      )}
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
