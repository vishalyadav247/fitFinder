// App Store review prompt (specs/settings.md › Feedback, specs/APP_REVIEW.md). Pure, so the gate
// and the link are testable and importable from client code. No state of our own: Shopify keeps
// the cooldown (60 days), the yearly cap (3) and "already reviewed", and refuses the request then.

/** Mirrors Shopify's `recently-installed` floor, so we don't make a call we know is refused. */
export const REVIEW_MIN_INSTALL_AGE_MS = 24 * 60 * 60 * 1000;

/** "Shoppers use the search": at least one storefront search in this many days (search_stats). */
export const REVIEW_ACTIVE_DAYS = 30;

/** The App Store's fragment that opens the write-a-review form on the listing. */
export const WRITE_REVIEW_FRAGMENT = "#modal-show=WriteReviewModal";

/**
 * Ask for a review only once the merchant has gotten value: installed over 24 hours ago and
 * shoppers searched in the last 30 days (current state, so a store that took the search down
 * isn't asked). No end date: Shopify's limits keep it to 3 asks a year at most.
 */
export function isReviewPromptEligible({
  installedAt,
  hasRecentSearches,
  now = new Date(),
}: {
  installedAt: Date | null | undefined;
  hasRecentSearches: boolean;
  now?: Date;
}): boolean {
  if (!installedAt || !hasRecentSearches) return false;
  return now.getTime() - installedAt.getTime() > REVIEW_MIN_INSTALL_AGE_MS;
}

const LISTING =
  /^https:\/\/apps\.shopify\.com\/([a-z0-9][a-z0-9-]*)\/?(?:[?#].*)?$/i;

/**
 * The write-a-review link from the listing URL (APP_STORE_URL), or null while there is no live
 * listing (unset, or an App Store search URL): the Settings link is hidden then.
 */
export function writeReviewUrl(appStoreUrl: string | null | undefined) {
  const handle = appStoreUrl?.trim().match(LISTING)?.[1];
  if (!handle || handle.toLowerCase() === "search") return null;
  return `https://apps.shopify.com/${handle}${WRITE_REVIEW_FRAGMENT}`;
}
