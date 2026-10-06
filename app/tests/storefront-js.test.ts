// The theme extension's storefront scripts (storefront-src/, M7): selection rules, My Selection
// storage, table sorting, and that the built assets are current and under Theme Check's limit.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const storage = new Map<string, string>();
const events: string[] = [];
// Node 24 has its own localStorage getter: replace it (and stub the bits of the DOM used).
const stubs = {
  window: globalThis,
  localStorage: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
  },
  document: {
    dispatchEvent: (e: Event) => void events.push(e.type),
    querySelector: () => null,
  },
};
for (const [key, value] of Object.entries(stubs)) {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
}

const core = await import("../../storefront-src/core.js");
const product = await import("../../storefront-src/product.js");
const ms = await import("../../storefront-src/my-selection.js");
const build = await import("../../scripts/build-theme-js.mjs");

const config = {
  v: 1,
  proxy: "/apps/fitfinder",
  heading: "Find parts for your vehicle",
  noun: "vehicle",
  things: "parts",
  fields: [
    {
      id: "make",
      label: "Make",
      placeholder: "Select make",
      type: "list",
      required: true,
    },
    {
      id: "year",
      label: "Year",
      placeholder: "Select year",
      type: "years",
      required: true,
    },
    {
      id: "model",
      label: "Model",
      placeholder: "Select model",
      type: "list",
      required: true,
    },
    {
      id: "engine",
      label: "Engine",
      placeholder: "Select engine",
      type: "list",
      required: false,
    },
  ],
  s: { maxSaved: "3" },
};
const sel = (make: string, year: string, model: string) => ({
  make,
  year,
  model,
});

beforeAll(() => {
  core.loadConfig(config);
});
beforeEach(() => {
  storage.clear();
  // the in-page copy core.js keeps when storage is blocked
  Object.assign(
    (globalThis as Record<string, unknown>).__fitfinderStore as object,
    { current: null, saved: [] },
  );
  events.length = 0;
});

describe("selections", () => {
  it("labels like the app (year + first dropdown, last dropdown)", () => {
    const p = sel("AUDI", "2008", "A6 C6 Avant (4F5)");
    expect(core.parts(p)).toEqual({
      top: "2008 AUDI",
      sub: "A6 C6 Avant (4F5)",
    });
    expect(core.label(p)).toBe("2008 AUDI A6 C6 Avant (4F5)");
  });

  it("is complete when every required field is picked", () => {
    expect(core.complete(sel("AUDI", "2008", "A6"))).toBe(true);
    expect(core.complete({ make: "AUDI", year: "2008" })).toBe(false);
    expect(core.complete({})).toBe(false);
  });

  it("drops unknown fields and empty values; keys ignore order", () => {
    expect(core.clean({ make: "AUDI", x: "1", model: "" })).toEqual({
      make: "AUDI",
    });
    expect(core.keyOf({ model: "A6", make: "AUDI" })).toBe(
      core.keyOf({ make: "AUDI", model: "A6" }),
    );
    expect(core.resultsUrl(sel("AUDI", "2008", "A6 C6"))).toBe(
      "/apps/fitfinder/results?make=AUDI&year=2008&model=A6+C6",
    );
  });
});

describe("My Selection store", () => {
  it("saves newest first, keeps max per shopper and makes it current", () => {
    for (const m of ["A", "B", "C", "D"]) core.save(sel(m, "2010", "X"));
    const { current, saved } = core.getStore();
    expect(saved.map((s: { make: string }) => s.make)).toEqual(["D", "C", "B"]);
    expect(current.make).toBe("D");
    expect(events).toContain(core.CHANGE);
    core.save(sel("B", "2010", "X")); // saving again moves it to the front
    expect(core.getStore().saved.map((s: { make: string }) => s.make)).toEqual([
      "B",
      "D",
      "C",
    ]);
    expect(core.isSaved(sel("C", "2010", "X"))).toBe(true);
  });

  it("removing the current selection selects the next one", () => {
    core.save(sel("A", "2010", "X"));
    core.save(sel("B", "2010", "X"));
    core.removeSaved(0);
    const { current, saved } = core.getStore();
    expect(saved).toHaveLength(1);
    expect(current.make).toBe("A");
  });

  it("ignores broken or incomplete stored data", () => {
    storage.set("fitfinder:selection:v1", "{not json");
    expect(core.getStore().saved).toEqual(expect.any(Array));
    storage.set(
      "fitfinder:selection:v1",
      JSON.stringify({
        current: { make: "A" },
        saved: [{ make: "A" }, sel("B", "2010", "X")],
      }),
    );
    const d = core.getStore();
    expect(d.current).toBeNull();
    expect(d.saved).toHaveLength(1);
  });
});

describe("fitment table", () => {
  const rows = [
    { v: { make: "BMW", model: "3" }, y: [2016, null] },
    { v: { make: "AUDI", model: "A6" }, y: [2008, 2011] },
    { v: { make: "AUDI", model: "A4" }, y: [2019, 2019] },
  ];
  it("shows years as the admin does", () => {
    expect(product.yearsText([2008, 2011])).toBe("2008 – 2011");
    expect(product.yearsText([2016, null])).toBe("2016 – now");
    expect(product.yearsText([2019, 2019])).toBe("2019");
    expect(product.yearsText(null)).toBe("—");
  });
  it("sorts A–Z by field order or newest year first", () => {
    expect(
      product
        .sortRows(rows, "fields")
        .map((r: { v: { model: string } }) => r.v.model),
    ).toEqual(["A6", "A4", "3"]);
    expect(
      product
        .sortRows(rows, "year")
        .map((r: { v: { model: string } }) => r.v.model),
    ).toEqual(["3", "A4", "A6"]);
  });
});

describe("My Selection icon", () => {
  it("uses the preset icons, an escaped custom image or none", () => {
    expect(ms.iconHtml({ savedIcon: "car" })).toContain("<svg");
    expect(ms.iconHtml({ savedIcon: "none" })).toBe("");
    expect(ms.iconHtml({ savedIcon: "custom", savedIconUrl: "" })).toBe("");
    expect(
      ms.iconHtml({
        savedIcon: "custom",
        savedIconUrl: 'https://x/a.png"onerror="x',
      }),
    ).toContain("https://x/a.png&#34;onerror=&#34;x");
  });
});

describe("built theme assets", () => {
  it("are current and under 10 KB each", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const [name, entry] of Object.entries(
      build.BUNDLES as Record<string, string>,
    )) {
      const code = await build.bundle(entry);
      expect(Buffer.byteLength(code), name).toBeLessThanOrEqual(
        build.MAX_BYTES,
      );
      expect(
        await readFile(build.OUT + name, "utf8"),
        `${name}: run npm run build:theme`,
      ).toBe(code);
    }
  }, 30_000);

  it("ships current stylesheets; the one on every page stays small", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const [name, parts] of Object.entries(
      build.STYLES as Record<string, string[]>,
    )) {
      const code = await build.styles(parts);
      expect(
        await readFile(build.OUT + name, "utf8"),
        `${name}: run npm run build:theme`,
      ).toBe(code);
    }
    // ff-embed.css is render-blocking on every page (app embed): keep it lean.
    const embed = await readFile(build.OUT + "ff-embed.css", "utf8");
    expect(Buffer.byteLength(embed)).toBeLessThanOrEqual(8_000);
    expect(embed).not.toContain(".ff-sfw");
    expect(embed).not.toContain(".ff-ft");
  });
});
