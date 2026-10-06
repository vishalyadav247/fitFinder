import type {
  HeadersFunction,
  LinksFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  isRouteErrorResponse,
  Outlet,
  useLoaderData,
  useLocation,
  useRouteError,
  useRouteLoaderData,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { getSearchConfig } from "../models/search-config.server";
import { publishStorefrontConfig } from "../services/storefront/sync.server";
import { shopPlan } from "../services/billing.server";
import { AppLoading } from "../components/AppLoading";
import theme from "../styles/theme.css?url";
import appLoading from "../styles/app-loading.css?url";

const ONBOARDING = "/app/onboarding";

// Sky theme tokens and the light polish; the loading screen (a <link>, so it stays styled even if
// hydration fails).
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: theme },
  { rel: "stylesheet", href: appLoading },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect, admin } = await authenticate.admin(request);
  // afterAuth only runs when a new session is stored; this covers shops whose session predates it.
  const shop = await ensureShop(session.shop);

  // A shop without a store type goes to onboarding first (specs/onboarding.md).
  const onOnboarding = new URL(request.url).pathname === ONBOARDING;
  if (!onOnboarding && !(await getSearchConfig(shop.id))) {
    throw redirect(ONBOARDING);
  }

  // Keep the theme's copy of the search fields and storefront settings current (app metafield).
  // Runs after every admin action too (loaders revalidate); writes only when something changed.
  try {
    await publishStorefrontConfig(admin.graphql, shop.id);
  } catch (error) {
    console.error("storefront config publish failed", {
      shop: session.shop,
      error,
    });
  }

  // Limit checks read shops.plan: refresh it on any admin page (Partner API, cached 5 min).
  // Not awaited: the page never waits on the Partner API; shopPlan logs its own failures.
  if (!onOnboarding) {
    shopPlan(admin.graphql, shop.id).catch((error) =>
      console.error("billing: plan refresh failed", {
        shop: session.shop,
        error,
      }),
    );
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
    <>
      <AppLoading />
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
    </>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in
// the response (boundary.error). Anything else (a failed database read, a bug) would be re-thrown
// to React Router's bare "Unexpected Application Error" page without App Bridge or the app menu
// (App Store 2.1.1: no web error pages), so it gets a plain Polaris page with a critical banner.
export function ErrorBoundary() {
  const error = useRouteError();
  const data = useRouteLoaderData<typeof loader>("routes/app");
  if (isRouteErrorResponse(error)) return boundary.error(error);

  const message =
    "This page couldn't be loaded. Reload the page to try again. If it keeps happening, contact support from Settings.";
  // The layout loader failed too: no API key, so no App Bridge or Polaris. Plain markup.
  if (!data?.apiKey) {
    return (
      <div style={{ padding: "48px 16px", maxWidth: 560, margin: "0 auto" }}>
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>
          Something went wrong
        </h1>
        <p style={{ margin: 0 }}>{message}</p>
      </div>
    );
  }
  return (
    <AppProvider apiKey={data.apiKey}>
      <s-page inlineSize="base">
        <s-banner tone="critical" heading="Something went wrong">
          {message}
        </s-banner>
      </s-page>
    </AppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
