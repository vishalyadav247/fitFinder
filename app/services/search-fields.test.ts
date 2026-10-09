import { describe, expect, it } from "vitest";
import {
  placeholderFor,
  placeholderToStore,
  remapTarget,
  targetsField,
} from "./search-fields";

describe("placeholders", () => {
  it("shows the default for an empty placeholder", () => {
    expect(placeholderFor({ label: "Make", placeholder: "" })).toBe(
      "Select make",
    );
    expect(placeholderFor({ label: "Make", placeholder: "Pick a brand" })).toBe(
      "Pick a brand",
    );
  });

  it("stores empty for cleared or default text, so renames update the default", () => {
    expect(placeholderToStore("Make", "  ")).toBe("");
    expect(placeholderToStore("Make", "Select make")).toBe("");
    expect(placeholderToStore("Make", " Pick a brand ")).toBe("Pick a brand");
  });
});

describe("remapTarget (type change keeps the saved mapping sensible)", () => {
  it("Dropdown → Year range turns the column into a one-column range", () => {
    expect(remapTarget("field:f1", "f1", "year_range")).toBe("field:f1:range");
    expect(remapTarget("field:f2", "f1", "year_range")).toBe("field:f2");
    expect(remapTarget("attachment", "f1", "year_range")).toBe("attachment");
  });

  it("Year range → Dropdown keeps one column and drops the 'to' column", () => {
    expect(remapTarget("field:f1:range", "f1", "list")).toBe("field:f1");
    expect(remapTarget("field:f1:from", "f1", "list")).toBe("field:f1");
    expect(remapTarget("field:f1:to", "f1", "list")).toBeNull();
    expect(remapTarget("field:f10:to", "f1", "list")).toBe("field:f10:to");
  });
});

describe("targetsField", () => {
  it("matches the field and its parts, not other fields with a shared prefix", () => {
    expect(targetsField("field:f1", "f1")).toBe(true);
    expect(targetsField("field:f1:to", "f1")).toBe(true);
    expect(targetsField("field:f10", "f1")).toBe(false);
    expect(targetsField("attachment", "f1")).toBe(false);
  });
});
