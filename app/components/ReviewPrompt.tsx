// Asks Shopify to show its App Store review modal once per app load (specs/APP_REVIEW.md).
// Rendered by the app layout inside AppProvider: child routes swap below it, so client-side
// navigations (which revalidate the loader) don't ask again. Shopify decides whether the modal
// appears; a refusal is invisible to the merchant and only logged here.
import { useEffect, useRef } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

export function ReviewPrompt({ eligible }: { eligible: boolean }) {
  const shopify = useAppBridge();
  const asked = useRef(false);

  useEffect(() => {
    if (!eligible || asked.current) return;
    // App Bridge comes from Shopify's CDN; an older cached copy has no Reviews API.
    if (typeof shopify?.reviews?.request !== "function") return;
    asked.current = true;
    shopify.reviews.request().then(
      (result) => {
        if (!result.success) {
          console.debug(`[reviews] not shown: ${result.code}`);
        }
      },
      (error) => console.debug("[reviews] request failed", error),
    );
  }, [eligible, shopify]);

  return null;
}
