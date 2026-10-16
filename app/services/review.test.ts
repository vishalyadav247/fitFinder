import { describe, expect, it } from "vitest";
import {
  isReviewPromptEligible,
  REVIEW_MIN_INSTALL_AGE_MS,
  writeReviewUrl,
} from "./review";

const now = new Date("2026-10-16T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("isReviewPromptEligible", () => {
  it("asks once installed over 24 hours ago with recent searches", () => {
    expect(
      isReviewPromptEligible({
        installedAt: ago(REVIEW_MIN_INSTALL_AGE_MS + 1),
        hasRecentSearches: true,
        now,
      }),
    ).toBe(true);
  });

  it("doesn't ask at or under 24 hours", () => {
    for (const age of [
      0,
      REVIEW_MIN_INSTALL_AGE_MS - 1,
      REVIEW_MIN_INSTALL_AGE_MS,
    ]) {
      expect(
        isReviewPromptEligible({
          installedAt: ago(age),
          hasRecentSearches: true,
          now,
        }),
      ).toBe(false);
    }
  });

  it("doesn't ask without recent searches or an install date", () => {
    expect(
      isReviewPromptEligible({
        installedAt: ago(30 * REVIEW_MIN_INSTALL_AGE_MS),
        hasRecentSearches: false,
        now,
      }),
    ).toBe(false);
    for (const installedAt of [null, undefined]) {
      expect(
        isReviewPromptEligible({ installedAt, hasRecentSearches: true, now }),
      ).toBe(false);
    }
  });
});

describe("writeReviewUrl", () => {
  it("opens the App Store's write-a-review form on the listing", () => {
    // The fragment is not validated by the App Store: a typo silently opens the plain listing.
    expect(writeReviewUrl("https://apps.shopify.com/sparefit")).toBe(
      "https://apps.shopify.com/sparefit#modal-show=WriteReviewModal",
    );
    expect(
      writeReviewUrl(
        " https://apps.shopify.com/sparefit-parts/?utm_source=x#reviews ",
      ),
    ).toBe(
      "https://apps.shopify.com/sparefit-parts#modal-show=WriteReviewModal",
    );
  });

  it("is hidden until the listing is live", () => {
    for (const url of [
      undefined,
      null,
      "",
      "https://apps.shopify.com/search?q=SpareFit",
      "https://apps.shopify.com/",
      "https://example.com/sparefit",
      "http://apps.shopify.com/sparefit",
    ]) {
      expect(writeReviewUrl(url)).toBeNull();
    }
  });
});
