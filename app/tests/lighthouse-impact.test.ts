import { describe, expect, it } from "vitest";

const lh = await import("../../scripts/lighthouse-impact.mjs");

describe("lighthouse impact script", () => {
  it("weights home 17%, product 40%, collection 43% (Shopify's method)", () => {
    expect(lh.weighted({ home: 100, product: 100, collection: 100 })).toBeCloseTo(100);
    expect(lh.weighted({ home: 50, product: 80, collection: 60 })).toBeCloseTo(66.3);
    expect(lh.MAX_DROP).toBe(10);
  });

  it("takes the median of the runs", () => {
    expect(lh.median([70, 90, 80])).toBe(80);
    expect(lh.median([70, 80])).toBe(75);
  });
});
