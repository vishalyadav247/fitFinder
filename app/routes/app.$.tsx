// Any /app/… URL without a page: a 404 inside the app layout, so the merchant gets the app's own
// "Page not found" (routes/app.tsx ErrorBoundary) with App Bridge and the app menu, instead of the
// bare root error page. Authenticated first like every app page (loaders run in parallel).
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  throw new Response(null, { status: 404, statusText: "Not Found" });
};

export default function NotFound() {
  return null;
}
