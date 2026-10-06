import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "react-router";

// Last resort for errors outside the app layout (an unknown URL, a failing landing page), instead
// of React Router's bare default error page (App Store 2.1.1). Errors inside /app are handled by
// the layout's own boundary (routes/app.tsx).
export function ErrorBoundary() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>FitFinder</title>
        <Meta />
        <Links />
      </head>
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <div style={{ padding: "48px 16px", maxWidth: 560, margin: "0 auto" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>
            {notFound ? "Page not found" : "Something went wrong"}
          </h1>
          <p style={{ margin: 0 }}>
            {notFound
              ? "This page doesn't exist. Open FitFinder from Apps in your Shopify admin."
              : "Reload the page to try again. If it keeps happening, open FitFinder from Apps in your Shopify admin."}
          </p>
        </div>
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
