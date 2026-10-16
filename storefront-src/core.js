// SpareFit storefront core (specs/storefront.md), shared by the three bundles that
// scripts/build-theme-js.mjs writes to extensions/sparefit-theme/assets/ (sp-search.js,
// sp-product.js, sp-embed.js; each under Theme Check's 10 KB). Each bundle carries its own copy
// of this module, so shared state lives where all of them see it: the config in the page
// (script[data-sp-config], from the app metafield), selections in localStorage, changes as a
// "sparefit:change" event on document.

const KEY = "sparefit:selection:v1";
export const CHANGE = "sparefit:change";
export const YEAR = new Date().getFullYear();
export const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/** @type {any} */
export let cfg = null;

/** Reads the config the blocks print (the first one wins). For tests: pass it in. */
export function loadConfig(given) {
  if (given !== undefined) return (cfg = given);
  if (cfg) return cfg;
  const el = document.querySelector("script[data-sp-config]");
  try {
    const c = el && JSON.parse(el.textContent);
    cfg = c && c.v === 1 && c.fields && c.fields.length ? c : null;
  } catch {
    cfg = null;
  }
  return cfg;
}

export const esc = (s) =>
  String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) => "&#" + c.charCodeAt(0) + ";",
  );

export const fill = (text, n) => String(text).split("{n}").join(n);

export const svg = (path, size, width) =>
  '<svg width="' +
  size +
  '" height="' +
  size +
  '" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="' +
  width +
  '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  path +
  "</svg>";

/* ---------- selections: picks = { fieldId: value } ---------- */

export function clean(picks) {
  const out = {};
  if (!picks || typeof picks !== "object") return out;
  for (const f of cfg.fields) {
    const v = picks[f.id];
    if (v != null && v !== "") out[f.id] = String(v);
  }
  return out;
}

export const keyOf = (picks) =>
  JSON.stringify(cfg.fields.map((f) => (picks && picks[f.id]) || ""));

/** Every required field picked (the search button's rule). */
export const complete = (picks) =>
  Object.keys(picks).length > 0 &&
  cfg.fields.every((f) => !f.required || picks[f.id]);

/** "2008 AUDI" + "A6 C6 Avant (4F5)": year and first dropdown, then the last dropdown. */
export function parts(picks) {
  const year = cfg.fields.find((f) => f.type === "years");
  const lists = cfg.fields
    .filter((f) => f.type !== "years" && picks[f.id])
    .map((f) => picks[f.id]);
  return {
    top: [year && picks[year.id], lists[0]].filter(Boolean).join(" "),
    sub: lists.length > 1 ? lists[lists.length - 1] : "",
  };
}

/** Same rule as selectionLabel() in the app (app/services/storefront/picks.ts). */
export function label(picks) {
  const p = parts(picks);
  return [p.top, p.sub].filter(Boolean).join(" ");
}

export function query(picks, extra) {
  const q = new URLSearchParams();
  for (const f of cfg.fields) if (picks[f.id]) q.set(f.id, picks[f.id]);
  for (const k of Object.keys(extra || {})) q.set(k, extra[k]);
  return q.toString();
}

/** SpareFit's own results page (also the no-JavaScript link target), with readable names. */
export function resultsUrl(picks) {
  const q = new URLSearchParams();
  for (const f of cfg.fields) if (picks[f.id]) q.set(f.n || f.id, picks[f.id]);
  return cfg.proxy + "/results?" + q;
}

/** The theme's search page for a query, under the shopper's language/market root. */
export function searchUrl(q) {
  const root =
    (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) ||
    "/";
  const params = new URLSearchParams({
    type: "product",
    "options[prefix]": "none",
    q,
  });
  return root + "search?" + params;
}

const SEARCHED = "sparefit:searched";

/**
 * "Show {products}": the theme's own search page for the SKUs that fit (its product cards and
 * filters), or SpareFit's results page when nothing fits or the list is too long
 * (app/routes/proxy.search.tsx). The selection becomes the current one.
 */
export function openResults(picks) {
  setCurrent(picks);
  try {
    sessionStorage.setItem(SEARCHED, keyOf(picks));
  } catch {
    // no session storage: My Selection can't tell the search page came from SpareFit
  }
  return api("search", query(picks)).then(
    (plan) => {
      // Setting "Show results on": SpareFit's page always, or the theme's search page.
      window.location.href =
        plan.mode === "search" && cfg.s.results !== "app"
          ? searchUrl(plan.q)
          : resultsUrl(picks);
    },
    () => {
      window.location.href = resultsUrl(picks);
    },
  );
}

/**
 * Theme search page opened by "Show {products}": the theme copies the SKU query
 * (variants.sku:"…" OR …) into its search boxes. Empty them; the results stay as they are.
 */
export function clearSkuQuery() {
  // Not hidden inputs: themes' filter and sort forms send q along with them.
  for (const input of document.querySelectorAll("input[name=q]:not([type=hidden])")) {
    if (input.value.startsWith("variants.sku:")) input.value = "";
  }
}

/** On a results page SpareFit opened (its own, or the theme's search page after a search). */
export function onResultsPage() {
  if (document.querySelector("[data-sp-results]")) return true;
  try {
    const current = getStore().current;
    return (
      /\/search\/?$/.test(location.pathname) &&
      !!current &&
      sessionStorage.getItem(SEARCHED) === keyOf(current)
    );
  } catch {
    return false;
  }
}

/* ---------- My Selection store (this browser) ---------- */

const mem = (window.__sparefitStore = window.__sparefitStore || {
  current: null,
  saved: [],
});

/** { current: picks | null, saved: picks[] }, read fresh so every bundle sees changes. */
export function getStore() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.saved)) {
      const current = d.current ? clean(d.current) : null;
      return {
        current: current && complete(current) ? current : null,
        saved: d.saved.map(clean).filter(complete),
      };
    }
  } catch {
    // storage blocked or broken: the in-page copy
  }
  return { current: mem.current, saved: mem.saved };
}

function setStore(d) {
  mem.current = d.current;
  mem.saved = d.saved;
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // private mode: keep it for this page
  }
  document.dispatchEvent(new CustomEvent(CHANGE));
}

export function setCurrent(picks) {
  setStore({
    current: picks && complete(picks) ? picks : null,
    saved: getStore().saved,
  });
}

export const isSaved = (picks) =>
  getStore().saved.some((s) => keyOf(s) === keyOf(picks));

/** Saves a selection first in the list (max per the settings) and makes it the current one. */
export function save(picks) {
  const k = keyOf(picks);
  const saved = [picks, ...getStore().saved.filter((s) => keyOf(s) !== k)];
  setStore({
    current: picks,
    saved: saved.slice(0, Number(cfg.s.maxSaved) || 5),
  });
}

export function removeSaved(i) {
  const { current, saved } = getStore();
  const gone = saved[i];
  const left = saved.filter((_, j) => j !== i);
  const wasCurrent = current && gone && keyOf(current) === keyOf(gone);
  setStore({ current: wasCurrent ? left[0] || null : current, saved: left });
}

/* ---------- app proxy ---------- */

const cache = {};
export function api(path, params) {
  const url = cfg.proxy + "/" + path + "?" + params;
  if (!cache[url]) {
    cache[url] = fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).then((r) => {
      if (!r.ok) throw new Error("SpareFit " + path + " " + r.status);
      return r.json();
    });
    cache[url].catch(() => delete cache[url]);
  }
  return cache[url];
}

/* ---------- start-up ---------- */

/** Runs `fn` once per element matching `selector`; `flag` keeps features of different bundles apart. */
export function each(selector, flag, fn) {
  document.querySelectorAll(selector).forEach((el) => {
    if (el[flag]) return;
    el[flag] = true;
    fn(el);
  });
}

/** Calls `init` when the DOM is ready (scripts load async) and again when the theme editor reloads a section. */
export function boot(init) {
  const run = () => {
    if (loadConfig()) init();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else run();
  document.addEventListener("shopify:section:load", run);
  return run;
}
