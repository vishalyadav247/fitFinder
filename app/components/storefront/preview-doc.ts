// Live previews of the Storefront page (specs/storefront.md): each preview is a sandboxed iframe
// running the real theme scripts and stylesheet (extensions/fitfinder-theme/assets) with the
// merchant's unsaved settings, so it looks and behaves exactly like the storefront.
//
// Inside the iframe the config's proxy is "#ff": a bridge (below) answers the scripts' app proxy
// calls — fits from the sample, options and results through the admin (postMessage → parent →
// /api/storefront-preview) — and every "go to the results page" becomes a harmless hash change.
// The iframe has no same-origin access (sandbox="allow-scripts"), so localStorage throws and
// the scripts keep selections in memory (window.__fitfinderStore), seeded here. Pure.
import type { StorefrontConfig } from "../../services/storefront/config";
import type { FitRow } from "../../services/storefront/query.server";

export type PreviewKind = "search" | "badge" | "table" | "selection";

export const PREVIEW_PROXY = "#ff";

type Picks = Record<string, string>;

interface FitsReply {
  state: "ask" | "fits" | "no-fit";
  universal: boolean;
  rows: FitRow[];
  total: number;
}

export interface BridgeInit {
  kind: PreviewKind;
  proxy: string;
  fieldIds: string[];
  fitsText: string;
  noResults: string;
  store: { current: Picks | null; saved: Picks[] };
  /** Answers to fits?product={key}. */
  fits: Record<string, FitsReply>;
}

/**
 * Runs first inside the iframe (serialized with toString, so it may only use its argument and
 * browser globals).
 */
export function bridge(init: BridgeInit) {
  const w = window as unknown as Record<string, unknown>;
  w.__fitfinderStore = { current: init.store.current, saved: init.store.saved };
  const reply = (body: unknown) => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
  const pending = new Map<
    number,
    { res: (v: unknown) => void; rej: (e: Error) => void }
  >();
  let next = 0;
  const ask = (path: string, q: string) =>
    new Promise((res, rej) => {
      const id = ++next;
      pending.set(id, { res, rej });
      parent.postMessage({ ff: "fetch", id, path, q }, "*");
    });
  const empty: FitsReply = {
    state: "ask",
    universal: false,
    rows: [],
    total: 0,
  };
  w.fetch = (input: unknown) => {
    const url = String(input);
    if (url.indexOf(init.proxy + "/") !== 0) {
      return Promise.reject(new Error("Not available in the preview"));
    }
    const rest = url.slice(init.proxy.length + 1).split("?");
    const path = rest[0];
    const q = rest[1] || "";
    if (path === "fits") {
      const product = new URLSearchParams(q).get("product") || "";
      return Promise.resolve(reply(init.fits[product] || empty));
    }
    // "Show {products}": FitFinder's own results page (= a hash change, handled below).
    if (path === "search") return Promise.resolve(reply({ mode: "page" }));
    return ask(path, q).then(reply);
  };
  addEventListener("message", (e) => {
    const d = e.data;
    if (e.source !== parent || !d || d.ff !== "reply") return;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.ok) p.res(d.body);
    else p.rej(new Error("Preview request failed"));
  });

  const results = () => document.getElementById("pv-results");
  const clearResults = () => {
    const box = results();
    if (box) box.textContent = "";
  };
  addEventListener("hashchange", () => {
    const hash = location.hash;
    if (hash.indexOf(init.proxy + "/results") !== 0) return;
    location.hash = "";
    const box = results();
    const go = document.querySelector<HTMLButtonElement>(".ff-sfw__go");
    if (!box) return;
    ask("results", hash.split("?")[1] || "").then(
      (body) => {
        const r = body as { titles: string[] };
        box.textContent = "";
        if (!r.titles.length) {
          const p = document.createElement("p");
          p.className = "pv-empty";
          p.textContent = init.noResults;
          box.appendChild(p);
        }
        for (const title of r.titles) {
          const card = document.createElement("div");
          card.className = "pv-card";
          const thumb = document.createElement("span");
          thumb.className = "pv-thumb";
          const text = document.createElement("div");
          const b = document.createElement("b");
          b.textContent = title;
          const fits = document.createElement("span");
          fits.textContent = String.fromCharCode(10003) + " " + init.fitsText;
          text.append(b, fits);
          const price = document.createElement("span");
          price.className = "pv-price";
          price.textContent = "[price]";
          card.append(thumb, text, price);
          box.appendChild(card);
        }
        if (go) go.disabled = false;
      },
      () => {
        if (go) go.disabled = false;
      },
    );
  });

  document.addEventListener("change", () => {
    if (init.kind !== "search") return;
    clearResults();
    const selects = document.querySelectorAll<HTMLSelectElement>(
      "[data-ff-search] select",
    );
    const picks: Picks = {};
    init.fieldIds.forEach((id, i) => {
      const v = selects[i] && selects[i].value;
      if (v) picks[id] = v;
    });
    parent.postMessage({ ff: "picks", picks }, "*");
  });
  document.addEventListener("click", (e) => {
    const t = e.target as Element | null;
    if (t && t.closest && t.closest(".ff-sfw__reset")) {
      clearResults();
      parent.postMessage({ ff: "picks", picks: {} }, "*");
    }
  });

  const report = () =>
    parent.postMessage(
      { ff: "height", h: document.documentElement.scrollHeight },
      "*",
    );
  addEventListener("DOMContentLoaded", () => {
    report();
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(report).observe(document.body);
    }
  });
}

// ---------------------------------------------------------------- document

const LT = String.fromCharCode(92) + "u003c";

/** JSON safe inside <script> (no "</script>" or "<!--"). */
export const scriptJson = (value: unknown) =>
  JSON.stringify(value).replace(/</g, LT);

/** JavaScript safe inside <script>. */
export const scriptCode = (code: string) =>
  code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");

const HARNESS_CSS = `
html,body{margin:0;background:transparent;color:#1a1a1a;font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif}
body{padding:2px}
[hidden]{display:none!important}
.pv-cap{margin:12px 0 6px;font-size:11px;font-weight:600;color:#8a8a8a;text-transform:uppercase;letter-spacing:.04em}
.pv-cap:first-child{margin-top:0}
.pv-table>.ff-table-wrap{background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:0 12px}
.pv-hidden{display:none;margin:0;font-size:12px;color:#a3a3a3;font-style:italic}
[data-ff-table][hidden]~.pv-hidden{display:block}
.pv-tabs{border:1px solid #e5e5e5;border-radius:10px;background:#fff;overflow:hidden}
.pv-tabs-bar{display:flex;gap:18px;padding:0 12px;border-bottom:1px solid #e5e5e5;font-size:13px;color:#737373;overflow-x:auto}
.pv-tabs-bar span{padding:10px 0;white-space:nowrap}
.pv-tabs-bar .on{color:#1a1a1a;font-weight:650;box-shadow:inset 0 -2px 0 #1a1a1a}
.pv-tabs-body{padding:4px 12px 2px;min-height:20px}
.pv-results{display:grid;gap:8px;margin-top:12px}
.pv-results:empty{display:none}
.pv-card{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:10px;border-radius:10px;background:#fff;box-shadow:0 0 0 1px #eaeaea}
.pv-card div{display:flex;flex-direction:column}
.pv-card div span{font-size:12px;color:#15803d}
.pv-thumb{width:40px;height:40px;border-radius:8px;background:repeating-linear-gradient(45deg,#e2e8f0,#e2e8f0 6px,#f1f5f9 6px,#f1f5f9 12px)}
.pv-price{font-weight:700}
.pv-empty{margin:0;font-size:13px;color:#737373}
body.pv-selection{height:100vh;padding:0;background:#fff;overflow:hidden}
`;

export interface PreviewSampleData {
  rows: FitRow[];
  selections: Picks[];
}

export interface PreviewInput {
  kind: PreviewKind;
  config: StorefrontConfig;
  css: string;
  script: string;
  sample: PreviewSampleData;
  /** Search widget: the picks to keep across rebuilds. */
  picks?: Picks;
}

/** A selection to show when the shop has no rows yet: the field names. */
export function demoSelection(config: StorefrontConfig): Picks {
  const out: Picks = {};
  for (const f of config.fields) {
    out[f.id] = f.type === "years" ? String(new Date().getFullYear()) : f.label;
  }
  return out;
}

function markup(kind: PreviewKind, config: StorefrontConfig): string {
  const cap = (t: string) => `<p class="pv-cap">${esc(t)}</p>`;
  switch (kind) {
    case "search":
      return `<div class="ff-search-wrap" data-ff-search></div><div id="pv-results" class="pv-results"></div>`;
    case "badge":
      return [
        cap("Before a selection"),
        `<div class="ff-badge-wrap" data-ff-badge data-product="ask"></div>`,
        cap("When it fits"),
        `<div class="ff-badge-wrap" data-ff-badge data-product="fits"></div>`,
        cap("When it doesn't fit"),
        `<div class="ff-badge-wrap" data-ff-badge data-product="no-fit"></div>`,
      ].join("");
    case "table": {
      const inTabs = config.s.tablePlace === "tabs";
      const spot = (product: string, note: string) => {
        const table = `<div class="ff-table-wrap${inTabs ? " ff-table-wrap--tabs" : ""}" data-ff-table${inTabs ? " data-ff-tabs" : ""} data-product="${product}"></div><p class="pv-hidden">${esc(note)}</p>`;
        return inTabs
          ? `<div class="pv-tabs"><div class="pv-tabs-bar"><span>Description</span><span>Specifications</span><span class="on">Fits these ${esc(config.noun)}s</span><span>Reviews</span></div><div class="pv-tabs-body pv-table">${table}</div></div>`
          : `<div class="pv-table">${table}</div>`;
      };
      return [
        cap("Product with rows"),
        spot("rows", "No filter rows yet. Import some to see sample rows."),
        cap("Product with no rows"),
        spot(
          "none",
          inTabs
            ? "The code shows nothing (the tab stays empty)"
            : "Nothing is shown",
        ),
      ].join("");
    }
    case "selection":
      return `<div hidden data-ff-embed></div>`;
  }
}

function bridgeInit(input: PreviewInput): BridgeInit {
  const { kind, config, sample } = input;
  const example = sample.selections[0] ?? demoSelection(config);
  const fits: Record<string, FitsReply> = {};
  let store: BridgeInit["store"] = { current: null, saved: [] };
  if (kind === "search") {
    const picks = input.picks ?? {};
    store = { current: Object.keys(picks).length ? picks : null, saved: [] };
  } else if (kind === "badge") {
    store = { current: example, saved: [] };
    const base = { universal: false, rows: [], total: 1 };
    fits.ask = { ...base, state: "ask" };
    fits.fits = { ...base, state: "fits" };
    fits["no-fit"] = { ...base, state: "no-fit" };
  } else if (kind === "table") {
    fits.rows = {
      state: "ask",
      universal: false,
      rows: sample.rows,
      total: sample.rows.length,
    };
    fits.none = { state: "ask", universal: false, rows: [], total: 0 };
  } else {
    const saved = sample.selections.length ? sample.selections : [example];
    store = { current: saved[0], saved };
  }
  return {
    kind,
    proxy: PREVIEW_PROXY,
    fieldIds: config.fields.map((f) => f.id),
    fitsText: config.s.fitsText,
    noResults: config.s.noResults,
    store,
    fits,
  };
}

/** The iframe's srcdoc. */
export function previewDoc(input: PreviewInput): string {
  const config = { ...input.config, proxy: PREVIEW_PROXY };
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${input.css.replace(/<\/style/gi, "<\\/style")}</style><style>${HARNESS_CSS}</style>
<script>(${scriptCode(bridge.toString())})(${scriptJson(bridgeInit({ ...input, config }))});</script>
</head><body class="pv-${input.kind}">
<script type="application/json" data-ff-config>${scriptJson(config)}</script>
${markup(input.kind, config)}
<script>${scriptCode(input.script)}</script>
</body></html>`;
}
