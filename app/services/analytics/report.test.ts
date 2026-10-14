// Analytics page wording and numbers (specs/analytics.md).
import { describe, expect, it } from "vitest";
import { changeLine, percent, selectionText, shortDay } from "./report";

describe("analytics report helpers", () => {
  it("compares with the previous period", () => {
    expect(changeLine(12, 10, 7)).toBe("+20% vs the previous 7 days");
    expect(changeLine(5, 10, 30)).toBe("-50% vs the previous 30 days");
    expect(changeLine(10, 10, 7)).toBe("Same as the previous 7 days");
    expect(changeLine(4, 0, 7)).toBe("None in the previous 7 days");
    expect(changeLine(0, 0, 90)).toBe("None in the previous 90 days either");
  });

  it("rounds percentages and refuses to divide by zero", () => {
    expect(percent(2, 3)).toBe(67);
    expect(percent(0, 0)).toBeNull();
  });

  it("writes a selection in field order and skips removed fields", () => {
    const fields = [{ id: "skin" }, { id: "concern" }, { id: "age" }];
    expect(
      selectionText(fields, { age: "30-40", skin: "Oily", concern: "Acne" }),
    ).toBe("Oily › Acne › 30-40");
    expect(selectionText(fields, { gone: "x", skin: "Dry" })).toBe("Dry");
    expect(selectionText(fields, { gone: "x" })).toBeNull();
  });

  it("formats days", () => {
    expect(shortDay("2026-10-03")).toBe("Oct 3");
  });
});
