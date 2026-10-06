// Storefront page previews: the iframe document and its bridge (preview-doc.ts). No DOM here,
// so the bridge runs against small stubs of the globals it uses.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StorefrontConfig } from "../../services/storefront/config";
import { defaultSettings } from "../../services/storefront/settings";
import {
  bridge,
  demoSelection,
  previewDoc,
  PREVIEW_PROXY,
  scriptCode,
  scriptJson,
  type BridgeInit,
} from "./preview-doc";

const config: StorefrontConfig = {
  v: 1,
  proxy: "/apps/fitfinder",
  heading: "Find parts </script><script>alert(1)</script>",
  noun: "vehicle",
  things: "parts",
  fields: [
    {
      id: "make",
      label: "Make",
      placeholder: "Select Make",
      type: "list",
      required: true,
    },
    {
      id: "year",
      label: "Year",
      placeholder: "Select Year",
      type: "years",
      required: true,
    },
  ],
  s: defaultSettings({
    storeType: "automotive",
    noun: "vehicle",
    things: "parts",
  }),
};
const sample = {
  rows: [{ v: { make: "AUDI" }, y: [2008, 2011] as [number, number] }],
  selections: [{ make: "AUDI", year: "2008" }],
};

/** The JSON passed to the bridge inside a document. */
function initOf(doc: string): BridgeInit {
  const m = /\}\)\((\{.*\})\);<\/script>/.exec(doc);
  return JSON.parse(m![1]);
}

describe("previewDoc", () => {
  it("escapes merchant text and scripts so nothing closes the script tags", () => {
    expect(scriptJson("</script>")).not.toContain("<");
    expect(scriptCode('x="</script>"')).toBe('x="<\\/script>"');
    const doc = previewDoc({
      kind: "search",
      config,
      css: "",
      script: "",
      sample,
    });
    expect(doc.match(/<\/script>/g)).toHaveLength(3);
    expect(doc).toContain('"proxy":"#ff"');
  });

  it("seeds each preview with its states", () => {
    const doc = (kind: "search" | "badge" | "table" | "selection") =>
      previewDoc({
        kind,
        config,
        css: "",
        script: "",
        sample,
        picks: { make: "BMW" },
      });
    expect(initOf(doc("search")).store.current).toEqual({ make: "BMW" });
    const badge = initOf(doc("badge"));
    expect(badge.store.current).toEqual(sample.selections[0]);
    expect(Object.keys(badge.fits)).toEqual(["ask", "fits", "no-fit"]);
    expect(doc("badge")).toContain('data-product="no-fit"');
    expect(initOf(doc("table")).fits.rows.rows).toEqual(sample.rows);
    expect(initOf(doc("selection")).store.saved).toEqual(sample.selections);
  });

  it("puts the table in a tab bar when it goes inside the theme's tabs", () => {
    const tabs = { ...config, s: { ...config.s, tablePlace: "tabs" as const } };
    const doc = previewDoc({
      kind: "table",
      config: tabs,
      css: "",
      script: "",
      sample,
    });
    expect(doc).toContain("data-ff-tabs");
    expect(doc).toContain("Fits these vehicles");
  });

  it("falls back to the field names when the shop has no rows", () => {
    expect(demoSelection(config)).toEqual({
      make: "Make",
      year: String(new Date().getFullYear()),
    });
  });
});

describe("bridge", () => {
  const saved = { ...globalThis };
  afterEach(() => {
    for (const k of [
      "window",
      "parent",
      "addEventListener",
      "document",
      "location",
      "fetch",
    ]) {
      (globalThis as Record<string, unknown>)[k] = (
        saved as Record<string, unknown>
      )[k];
    }
  });

  function run(init: Partial<BridgeInit> = {}) {
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    const posted: Record<string, unknown>[] = [];
    const parent = {
      postMessage: (m: Record<string, unknown>) => posted.push(m),
    };
    Object.assign(globalThis, {
      window: globalThis,
      parent,
      location: { hash: "" },
      addEventListener: (t: string, fn: (e: unknown) => void) =>
        (listeners[t] ||= []).push(fn),
      document: {
        addEventListener: vi.fn(),
        getElementById: () => null,
        querySelector: () => null,
      },
    });
    const full: BridgeInit = {
      kind: "search",
      proxy: PREVIEW_PROXY,
      fieldIds: ["make"],
      fitsText: "Fits",
      noResults: "None",
      store: { current: null, saved: [] },
      fits: { "1": { state: "fits", universal: false, rows: [], total: 1 } },
      ...init,
    };
    // As in the iframe: the serialized function, with no access to this module.
    new Function("init", `(${bridge.toString()})(init)`)(full);
    const fetch = (
      globalThis as unknown as { fetch: (u: string) => Promise<Response> }
    ).fetch;
    return { listeners, posted, parent, fetch };
  }

  it("answers fits from the sample and turns search into the results page", async () => {
    const { fetch } = run();
    expect(
      await (await fetch("#ff/fits?product=1&make=A")).json(),
    ).toMatchObject({
      state: "fits",
    });
    expect(await (await fetch("#ff/search?make=A")).json()).toEqual({
      mode: "page",
    });
  });

  it("asks the admin for options and resolves with its reply", async () => {
    const { fetch, posted, listeners, parent } = run();
    const pending = fetch("#ff/options?field=make");
    expect(posted[0]).toMatchObject({
      ff: "fetch",
      path: "options",
      q: "field=make",
    });
    listeners.message[0]({
      source: parent,
      data: {
        ff: "reply",
        id: posted[0].id,
        ok: true,
        body: { options: ["AUDI"] },
      },
    });
    expect(await (await pending).json()).toEqual({ options: ["AUDI"] });
  });

  it("ignores replies from other windows and blocks other URLs", async () => {
    const { fetch, posted, listeners } = run();
    let settled = false;
    fetch("#ff/options?field=make").then(() => (settled = true));
    listeners.message[0]({
      source: {},
      data: { ff: "reply", id: posted[0].id, ok: true },
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await expect(fetch("https://evil.example/")).rejects.toThrow();
  });

  it("seeds the in-memory selection store the scripts use", () => {
    run({ store: { current: { make: "A" }, saved: [{ make: "A" }] } });
    expect((globalThis as Record<string, unknown>).__fitfinderStore).toEqual({
      current: { make: "A" },
      saved: [{ make: "A" }],
    });
  });
});
