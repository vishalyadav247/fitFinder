import { describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({ default: {} }));

import { setupInputSchema } from "./search-config.server";

describe("setupInputSchema (onboarding form)", () => {
  it("accepts a known store type and parses replace", () => {
    expect(
      setupInputSchema.parse({ storeType: "beauty", replace: "true" }),
    ).toEqual({ storeType: "beauty", replace: true });
    expect(
      setupInputSchema.parse({ storeType: "custom", replace: "false" }),
    ).toEqual({ storeType: "custom", replace: false });
  });

  it.each([
    {},
    { storeType: "cars", replace: "false" },
    { storeType: "automotive" },
    { storeType: "automotive", replace: "yes" },
  ])("rejects %j", (input) => {
    expect(setupInputSchema.safeParse(input).success).toBe(false);
  });
});
