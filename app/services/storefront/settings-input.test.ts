import { describe, expect, it } from "vitest";
import { EDITABLE_KEYS, parseSettingValue, TEXT_MAX } from "./settings";

describe("parseSettingValue", () => {
  it("accepts each kind of setting", () => {
    expect(parseSettingValue("layout", "card")).toBe("card");
    expect(parseSettingValue("btn", "#1d4ed8")).toBe("#1D4ED8");
    expect(parseSettingValue("labels", true)).toBe(true);
    expect(parseSettingValue("button", "  Show parts ")).toBe("Show parts");
    expect(
      parseSettingValue("tableHide", { make: true, model: false }),
    ).toEqual({
      make: true,
    });
    expect(parseSettingValue("savedIconUrl", "")).toBe("");
  });

  it("refuses wrong kinds, unknown choices and bad colours", () => {
    expect(parseSettingValue("layout", "grid")).toBeNull();
    expect(parseSettingValue("labels", "true")).toBeNull();
    expect(parseSettingValue("btn", "red")).toBeNull();
    expect(parseSettingValue("btn", "#1D4ED8FF")).toBeNull();
    expect(parseSettingValue("maxSaved", 5)).toBeNull();
  });

  it("refuses empty and too long texts", () => {
    expect(parseSettingValue("button", "   ")).toBeNull();
    expect(parseSettingValue("button", "x".repeat(TEXT_MAX + 1))).toBeNull();
  });

  it("refuses keys the page doesn't edit and icon URLs set by hand", () => {
    expect(parseSettingValue("resetText", "Clear")).toBeNull();
    expect(parseSettingValue("__proto__", {})).toBeNull();
    expect(
      parseSettingValue("savedIconUrl", "https://evil.example/x.svg"),
    ).toBeNull();
    expect(EDITABLE_KEYS).not.toContain("hintSub");
  });

  it("refuses odd tableHide objects", () => {
    expect(parseSettingValue("tableHide", [])).toBeNull();
    expect(parseSettingValue("tableHide", { make: "yes" })).toBeNull();
    expect(parseSettingValue("tableHide", { "bad id!": true })).toBeNull();
  });
});
