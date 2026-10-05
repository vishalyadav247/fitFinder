import { describe, expect, it } from "vitest";
import { STORE_TYPES, STORE_TYPE_KEYS, buildSetup } from "./store-types";

describe("store type presets (match .claude/design/scripts/data/store-types.js)", () => {
  it.each([
    ["automotive", ["Make", "Year", "Model"], "vehicle", "parts"],
    ["phones", ["Brand", "Series", "Model"], "phone", "accessories"],
    ["beauty", ["Brand", "Product type", "Gender"], "profile", "products"],
    ["custom", ["Brand", "Model"], "item", "products"],
  ] as const)("%s", (key, labels, noun, things) => {
    const p = STORE_TYPES[key];
    expect(p.fields.map((f) => f.label)).toEqual(labels);
    expect(p.noun).toBe(noun);
    expect(p.things).toBe(things);
  });

  it("only automotive has a year range field", () => {
    for (const key of STORE_TYPE_KEYS) {
      const years = STORE_TYPES[key].fields.filter(
        (f) => f.type === "year_range",
      );
      expect(years.length).toBe(key === "automotive" ? 1 : 0);
    }
  });
});

describe("buildSetup", () => {
  it("creates ordered, required fields with default (empty) placeholders", () => {
    const { config, fields } = buildSetup("automotive");
    expect(config).toEqual({
      storeType: "automotive",
      heading: "Find parts for your vehicle",
      noun: "vehicle",
      thingsWord: "parts",
    });
    expect(fields).toEqual([
      {
        position: 0,
        label: "Make",
        placeholder: "",
        type: "list",
        required: true,
      },
      {
        position: 1,
        label: "Year",
        placeholder: "",
        type: "year_range",
        required: true,
      },
      {
        position: 2,
        label: "Model",
        placeholder: "",
        type: "list",
        required: true,
      },
    ]);
  });
});
