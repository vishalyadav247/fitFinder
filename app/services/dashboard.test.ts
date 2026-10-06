import { describe, expect, it } from "vitest";
import {
  guideSteps,
  overviewCards,
  plural,
  type DashboardFacts,
} from "./dashboard";
import { featuresAdded } from "./dashboard.server";

const facts = (over: Partial<DashboardFacts> = {}): DashboardFacts => ({
  fields: [
    { label: "Make", type: "list" },
    { label: "Year", type: "years" },
    { label: "Model", type: "list" },
  ],
  noun: "vehicle",
  things: "parts",
  rowCount: 0,
  skus: 0,
  unlinkedSkus: 0,
  withoutData: 0,
  coverage: [],
  embedOn: false,
  blocksAdded: 0,
  plan: "none",
  planChosen: false,
  trialEndsAt: null,
  ...over,
});

describe("setup guide", () => {
  it("starts with only the search setup done", () => {
    const steps = guideSteps(facts());
    expect(steps.map((s) => s.done)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(steps[0].description).toContain("Make › Year › Model");
    expect(steps[1].to).toBe("/app/search-setup?import=1");
  });

  it("follows the real state of each step", () => {
    const steps = guideSteps(
      facts({
        rowCount: 10,
        skus: 4,
        unlinkedSkus: 1,
        embedOn: true,
        planChosen: true,
        plan: "growth",
      }),
    );
    expect(steps.map((s) => s.done)).toEqual([true, true, false, true, true]);
    expect(steps[2].description).toBe(
      "1 SKU has no product yet. Shoppers won't see it until it is linked to a product in your store.",
    );
    expect(steps[4].description).toBe(
      "You are on the Growth plan. Change it any time as your catalog grows.",
    );
  });

  it("mentions trial days and the products word", () => {
    const now = new Date("2026-10-06T00:00:00Z");
    const steps = guideSteps(
      facts({
        things: "accessories",
        rowCount: 3,
        skus: 3,
        planChosen: true,
        plan: "pro",
        trialEndsAt: new Date("2026-10-08T00:00:00Z"),
      }),
      now,
    );
    expect(steps[2].description).toContain("all of your accessories");
    expect(steps[4].description).toContain("Pro trial, 2 days left");
  });
});

describe("overview", () => {
  it("shows live state, coverage and link share", () => {
    const cards = overviewCards(
      facts({
        embedOn: true,
        blocksAdded: 2,
        rowCount: 1200,
        skus: 10,
        unlinkedSkus: 3,
        withoutData: 4,
        coverage: [
          { label: "Make", count: 9 },
          { label: "Model", count: 1 },
          { label: "Series", count: 2 },
        ],
      }),
    );
    expect(cards.map((c) => [c.value, c.badge?.text ?? null, c.line])).toEqual([
      ["Live", null, "2 of 4 blocks added"],
      ["1,200", null, "9 makes · 1 model · 2 series"],
      ["3", "Needs linking", "70% of SKUs linked"],
      ["4", null, "Not shown in any search"],
    ]);
  });

  it("says Hidden when the embed is off and admits an unreadable theme", () => {
    expect(overviewCards(facts())[0]).toMatchObject({
      value: "Off",
      badge: { text: "Hidden" },
    });
    expect(overviewCards(facts())[1].line).toBe("No data yet");
    expect(
      overviewCards(facts({ embedOn: null, blocksAdded: null }))[0],
    ).toMatchObject({
      value: "—",
      badge: null,
      line: "Couldn't check your theme",
    });
  });

  it("pluralizes field names like the prototype", () => {
    expect(plural("Make", 2)).toBe("makes");
    expect(plural("Box", 2)).toBe("boxes");
    expect(plural("Body style", 1)).toBe("body style");
    expect(plural("Country", 3)).toBe("countries");
    expect(plural("Series", 3)).toBe("series");
  });

  it("counts the four storefront features as on the Storefront page", () => {
    const status = {
      embedOn: true,
      blocks: { search: "index" },
      tableCodeFound: true,
    };
    expect(featuresAdded(status, { tablePlace: "tabs", garage: true })).toBe(3);
    expect(featuresAdded(status, { tablePlace: "block", garage: false })).toBe(
      1,
    );
  });
});
