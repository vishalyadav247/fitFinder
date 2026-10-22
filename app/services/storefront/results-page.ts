// SpareFit's own results page (app proxy /apps/sparefit/results): Liquid that Shopify renders
// inside the shop's theme (specs/storefront.md › Results page tab). Results normally open on the
// theme's search page (proxy.search.tsx); this page is used when the merchant picks it under
// Show results on, when nothing fits, or when the SKU list is too long for one search.
// Layout: search widget, title, then the filters (from product tags) on the left and the product
// grid on the right; on mobile the filters open as a drawer from a "Filters" button. Product cards come
// from Liquid's all_products (20 unique handles per page, so at most 20 per page), so prices,
// images and URLs are the live storefront's. The admin preview renders the same markup with
// static cards (resultsBody), so it matches the page by construction.
import type { StorefrontConfig } from "./config";
import type { ResultsPage } from "./query.server";
import type {
  Facet,
  FilterPicks,
  ResultsPageSettings,
} from "./results-settings";
import { defaultResultsPage, SORTS, MIN_MORE } from "./results-settings";

/** What a link on the page changes: filter picks, sort and page. */
export interface ResultsState {
  filterPicks: FilterPicks;
  sort: ResultsPageSettings["sort"];
  page: number;
}

export interface ResultsView {
  config: StorefrontConfig;
  /** field id → picked value */
  picks: Record<string, string>;
  label: string;
  complete: boolean;
  results: ResultsPage | null;
  settings: ResultsPageSettings;
  state: ResultsState;
  /** This page's URL for another state (the picks stay). */
  href: (state: ResultsState) => string;
  /** The picks as URL pairs: hidden inputs of the sort form. */
  pickQuery: [string, string][];
}

/** Text inside Liquid output: HTML-escaped, and braces escaped so it can't start a Liquid tag. */
export function escapeLiquidText(value: string): string {
  return value.replace(/[&<>"'{}%]/g, (c) => `&#${c.charCodeAt(0)};`);
}

const t = escapeLiquidText;

// Characters that would break out of a Liquid string literal or tag.
const SAFE_HANDLE = /^[^'"{}%<>\s\\]+$/;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The page title's inline style from the settings (alignment, size, colour). */
function titleStyle(s: ResultsPageSettings): string {
  const parts = [`text-align:${s.titleAlign}`];
  if (s.titleSize > 0) parts.push(`font-size:${Math.round(s.titleSize)}px`);
  if (/^#[0-9a-fA-F]{6}$/.test(s.titleColor))
    parts.push(`color:${s.titleColor}`);
  return parts.join(";");
}

/** The page heading when the merchant hasn't set one: "Parts that fit your vehicle". */
export const defaultPageTitle = (config: { things: string; noun: string }) =>
  `${capitalize(config.things)} that fit your ${config.noun}`;

type Card = (p: { handle: string; universal: boolean }) => string;

/** Live page card: the product read from all_products. */
const liquidCard =
  (fitsText: string): Card =>
  (p) =>
    SAFE_HANDLE.test(p.handle)
      ? `{%- assign sp_p = all_products['${p.handle}'] -%}{%- if sp_p.id -%}
<li class="sp-card"><a href="{{ sp_p.url }}">
  {%- if sp_p.featured_image -%}{{ sp_p.featured_image | image_url: width: 480 | image_tag: loading: 'lazy', class: 'sp-card__img', alt: sp_p.title }}{%- else -%}<span class="sp-card__img sp-card__img--none"></span>{%- endif -%}
  <span class="sp-card__t">{{ sp_p.title | escape }}</span>
  <span class="sp-card__fit">&#10003; ${t(fitsText)}</span>
  <span class="sp-card__p">{{ sp_p.price | money }}</span>
</a></li>{%- endif -%}`
      : "";

export function resultsLiquid(view: ResultsView): string {
  return `${STYLE}${resultsBody(view, liquidCard(view.config.s.fitsText), true)}${SCRIPT}`;
}

/**
 * Filters, Clear all, the sort and paging without a page reload (agreed 2026-10-22): the new page
 * is fetched in the background, its filters and products (.sp-rp) replace the current ones, and
 * the address follows (history.pushState; Back and Forward work). Product links are left alone.
 * Without JavaScript, or when anything fails, the links and the Sort button load the page as
 * before. No Liquid tags inside (no double braces).
 */
const SCRIPT = `<script>
(function () {
  if (!window.fetch || !window.DOMParser || !history.pushState) return;
  var run = 0;
  function swap(url, push) {
    var box = document.querySelector(".sp-rp");
    if (!box) { location.href = url; return; }
    var ft = document.getElementById("sp-rp-ft");
    var open = !!(ft && ft.checked);
    var mine = ++run;
    box.setAttribute("aria-busy", "true");
    box.style.opacity = "0.6";
    fetch(url, { credentials: "same-origin" })
      .then(function (r) { if (!r.ok) throw r; return r.text(); })
      .then(function (html) {
        if (mine !== run) return;
        var next = new DOMParser().parseFromString(html, "text/html").querySelector(".sp-rp");
        if (!next) throw next;
        box.replaceWith(next);
        var nft = document.getElementById("sp-rp-ft");
        if (nft && open) nft.checked = true;
        if (push) history.pushState({ sp: 1 }, "", url);
      })
      .catch(function () { location.href = url; });
  }
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('.sp-rp a[rel="nofollow"], .sp-rp .sp-pager a');
    if (!a) return;
    var u = new URL(a.href, location.href);
    if (u.origin !== location.origin) return;
    e.preventDefault();
    swap(u.href, true);
    if (a.closest(".sp-pager")) {
      var top = document.querySelector(".sp-results__title") || document.querySelector(".sp-rp");
      if (top) top.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  document.addEventListener("change", function (e) {
    var sel = e.target;
    if (!sel || sel.name !== "sort" || !sel.closest(".sp-rp__sort")) return;
    var form = sel.form;
    var q = new URLSearchParams(new FormData(form));
    swap(form.action + "?" + q.toString(), true);
  });
  window.addEventListener("popstate", function () { swap(location.href, false); });
})();
</script>`;

/** Toggles one value of a filter in the picks (back to page 1). */
function toggled(
  state: ResultsState,
  filterId: string,
  value: string,
): ResultsState {
  const key = value.toLowerCase();
  const cur = state.filterPicks[filterId] ?? [];
  const next = cur.includes(key) ? cur.filter((v) => v !== key) : [...cur, key];
  const filterPicks = { ...state.filterPicks };
  if (next.length) filterPicks[filterId] = next;
  else delete filterPicks[filterId];
  return { ...state, filterPicks, page: 1 };
}

function optionHtml(
  view: ResultsView,
  filterId: string,
  v: Facet["values"][number],
) {
  const { settings, state, href } = view;
  return `<li><a class="sp-rp__o${v.on ? " is-on" : ""}" href="${t(href(toggled(state, filterId, v.value)))}" rel="nofollow" role="checkbox" aria-checked="${v.on}"><span class="sp-rp__box" aria-hidden="true"></span><span class="sp-rp__v">${t(v.value)}</span>${settings.showCounts ? `<span class="sp-rp__n">${v.count}</span>` : ""}</a></li>`;
}

/** A filter in the sidebar or drawer: a group that opens and closes, "Show more" after 10. */
function groupHtml(
  view: ResultsView,
  { filter, values }: Facet,
  index: number,
) {
  const { settings } = view;
  const picked = values.filter((v) => v.on).length;
  const cut =
    settings.valuesShown !== "all" &&
    values.length >= Number(settings.valuesShown) + MIN_MORE
      ? Number(settings.valuesShown)
      : values.length;
  const first = values.slice(0, cut);
  const rest = values.slice(cut);
  const list = (vs: typeof values) =>
    vs.map((v) => optionHtml(view, filter.id, v)).join("");
  const more = rest.length
    ? `<details class="sp-rp__more"${rest.some((v) => v.on) ? " open" : ""}><summary>Show ${rest.length} more</summary><ul>${list(rest)}</ul></details>`
    : "";
  const open =
    settings.groupsOpen === "all" ||
    (settings.groupsOpen === "first" && index === 0) ||
    picked > 0;
  return `<details class="sp-rp__g"${open ? " open" : ""}><summary class="sp-rp__gt">${t(filter.label)}${picked ? ` <span class="sp-rp__pc">${picked}</span>` : ""}</summary><ul>${list(first)}</ul>${more}</details>`;
}

/** A filter in the horizontal bar: a dropdown (one open at a time where browsers allow it). */
function dropdownHtml(view: ResultsView, { filter, values }: Facet) {
  const picked = values.filter((v) => v.on).length;
  const items = values.map((v) => optionHtml(view, filter.id, v)).join("");
  return `<details class="sp-rp__dd" name="sp-rp-dd"><summary>${t(filter.label)}${picked ? ` <span class="sp-rp__pc">${picked}</span>` : ""}</summary><div class="sp-rp__ddp"><ul>${items}</ul></div></details>`;
}

interface FilterParts {
  /** Markup placed before the main column (sidebar / drawer / bar). */
  side: string;
  /** The Filters button in the toolbar (drawer layout). */
  button: string;
}

function filterParts(view: ResultsView, facets: Facet[]): FilterParts | null {
  const { settings, state, href } = view;
  const shown = facets.filter((f) => f.values.length);
  if (!shown.length) return null;
  const picked = Object.values(state.filterPicks).flat().length;
  const title = t(settings.filterTitle);
  const label = `${title}${picked ? ` (${picked})` : ""}`;
  const clear = picked
    ? `<a class="sp-rp__clear" href="${t(href({ ...state, filterPicks: {}, page: 1 }))}" rel="nofollow">Clear all</a>`
    : "";
  const groups = shown.map((f, i) => groupHtml(view, f, i)).join("");
  // The panel that slides in: always for the drawer layout, and on mobile for the other two
  // (a checkbox and labels open and close it, so no script is needed).
  const toggle = `<input type="checkbox" id="sp-rp-ft" class="sp-rp__ft">`;
  const shade = `<label for="sp-rp-ft" class="sp-rp__shade" aria-hidden="true"></label>`;
  const head = (closeClass: string) =>
    `<div class="sp-rp__sh"><p class="sp-rp__st">${title}</p>${clear}<label for="sp-rp-ft" class="sp-rp__x${closeClass}" aria-label="Close">&times;</label></div>`;
  const button = (mobileOnly: boolean) =>
    `<label for="sp-rp-ft" class="sp-rp__fbtn${mobileOnly ? " sp-rp__fbtn--m" : ""}">${label}</label>`;
  if (settings.filterLayout === "horizontal") {
    return {
      side: `<div class="sp-rp__hbar" role="group" aria-label="${title}"><span class="sp-rp__st">${title}:</span>${shown.map((f) => dropdownHtml(view, f)).join("")}${clear}</div>
${toggle}<aside class="sp-rp__drawer sp-rp__mdrawer" aria-label="${title}">${head("")}${groups}</aside>${shade}`,
      button: button(true),
    };
  }
  if (settings.filterLayout === "drawer") {
    return {
      side: `${toggle}<aside class="sp-rp__drawer" aria-label="${title}">${head("")}${groups}</aside>${shade}`,
      button: button(false),
    };
  }
  return {
    side: `${toggle}<aside class="sp-rp__side" aria-label="${title}">${head(" sp-rp__x--m")}${groups}</aside>${shade}`,
    button: button(true),
  };
}

function sortHtml(view: ResultsView, live: boolean): string {
  const { state, config } = view;
  const hidden = [
    ...view.pickQuery,
    ...Object.entries(state.filterPicks).flatMap(([id, values]) =>
      values.map((v): [string, string] => [`f_${id}`, v]),
    ),
  ]
    .map(([k, v]) => `<input type="hidden" name="${t(k)}" value="${t(v)}">`)
    .join("");
  const options = SORTS.map(
    ([value, label]) =>
      `<option value="${value}"${value === state.sort ? " selected" : ""}>${t(label)}</option>`,
  ).join("");
  return `<form class="sp-rp__sort" method="get"${live ? ` action="${t(config.proxy)}/results"` : ""}>${hidden}<label><span>Sort by</span> <select name="sort">${options}</select></label>${live ? '<noscript><button type="submit">Sort</button></noscript>' : ""}</form>`;
}

/**
 * The page's markup (without the stylesheet). `live`: the real page (search widget mount point,
 * working sort form); otherwise the admin preview (`previewWidget`: the widget drawn statically,
 * inert form).
 */
export function resultsBody(
  view: ResultsView,
  card: Card,
  live: boolean,
  previewWidget = "",
) {
  // Over the defaults, so a document saved before a setting existed still lays out.
  const settings = { ...defaultResultsPage(), ...view.settings };
  view = { ...view, settings };
  const { config, results, state, href } = view;
  const widget = !settings.showWidget
    ? ""
    : live
      ? `<div class="sp-search-wrap" data-sp-search data-sp-context="results"></div>`
      : previewWidget;
  const head = `<div class="page-width sp-results-outer"><div class="sp-results" data-sp-results data-sp-picks="${t(JSON.stringify(view.picks))}">
  ${widget}
  ${settings.showTitle ? `<h1 class="sp-results__title" style="${titleStyle(settings)}">${t(settings.pageTitle.trim() || defaultPageTitle(config))}</h1>` : ""}
`;
  if (!view.complete || !results) {
    return `${head}
  <p class="sp-results__empty">${t(`Select your ${config.noun} to see the ${config.things} that fit.`)}</p>
</div></div>`;
  }
  const filters = filterParts(view, results.facets);
  const cards = results.products.map(card).join("\n");
  const picked = Object.values(state.filterPicks).flat().length > 0;
  const empty = !results.products.length
    ? `<p class="sp-results__empty">${t(picked ? `No ${config.things} match these filters.` : config.s.noResults)}${
        picked
          ? ` <a href="${t(href({ ...state, filterPicks: {}, page: 1 }))}" rel="nofollow">Clear all</a>`
          : ""
      }</p>`
    : "";
  const pager =
    results.pageCount > 1
      ? `<nav class="sp-pager" aria-label="Pages">${
          results.page > 1
            ? `<a href="${t(href({ ...state, page: results.page - 1 }))}" rel="prev">&larr;</a>`
            : ""
        }<span>${results.page} / ${results.pageCount}</span>${
          results.page < results.pageCount
            ? `<a href="${t(href({ ...state, page: results.page + 1 }))}" rel="next">&rarr;</a>`
            : ""
        }</nav>`
      : "";
  const count = `${results.total.toLocaleString("en-US")} ${results.total === 1 ? "result" : "results"}`;
  // The picked tags as removable chips in the toolbar (Clear all is in the filter heading).
  const chips = results.facets.flatMap(({ filter, values }) =>
    values
      .filter((v) => v.on)
      .map(
        (v) =>
          `<a class="sp-rp__chip" href="${t(href(toggled(state, filter.id, v.value)))}" rel="nofollow" aria-label="${t(`Remove ${filter.label}: ${v.value}`)}"><span>${t(filter.label)}: ${t(v.value)}</span><span aria-hidden="true">&times;</span></a>`,
      ),
  );
  // The toolbar: Filters button (drawer / mobile), result count, picked tags, Sort by.
  const bar = `${filters?.button ?? ""}${settings.showCount ? `<p class="sp-rp__count">${t(count)}</p>` : ""}${chips.length ? `<div class="sp-rp__chips">${chips.join("")}</div>` : ""}${settings.showSort ? sortHtml(view, live) : ""}`;
  // Next to a sidebar the bar always shows (even empty), so the first filter group and the first
  // row of products start at the same height.
  const sidebar = !!filters && settings.filterLayout === "vertical";
  return `${head}
  <div class="sp-rp ${filters ? `sp-rp--${settings.filterLayout}${settings.filterLayout === "vertical" && settings.filterSide === "right" ? " sp-rp--right" : ""}` : "sp-rp--nofilters"}" style="--sp-cols:${settings.columns};--sp-mcols:${settings.mobileColumns};--sp-acc:${t(config.s.btn)}">
  ${filters?.side ?? ""}
  <div class="sp-rp__main">
    ${bar || sidebar ? `<div class="sp-rp__bar">${bar}</div>` : ""}
    ${cards ? `<ul class="sp-grid">${cards}</ul>` : ""}
    ${empty}
    ${pager}
  </div>
  </div>
</div></div>`;
}

// Inline, so the page has its layout even when the app embed (and its stylesheet) is off.
export const STYLE = `<style>
.sp-results{box-sizing:border-box;width:min(100%,var(--narrow-page-width,1440px),100vw - 80px);margin-inline:auto;padding-top:24px;padding-bottom:48px}
.page-width-normal .sp-results{width:min(100%,var(--normal-page-width,1920px),100vw - 80px)}
@media (max-width:749px){.sp-results{width:min(100%,100vw - 40px)}.page-width-normal .sp-results{width:min(100%,100vw - 40px)}}
.sp-results__title{margin:20px 0 16px}
.sp-results__empty{margin:16px 0}
.sp-rp{--sp-acc:#1a1a1a;--sp-line:rgba(0,0,0,.09);--sp-soft:#f4f4f5;display:grid;grid-template-columns:minmax(0,1fr);gap:20px;align-items:start}
.sp-rp--vertical{grid-template-columns:250px minmax(0,1fr);grid-template-areas:"side main";column-gap:40px}
.sp-rp--vertical.sp-rp--right{grid-template-columns:minmax(0,1fr) 250px;grid-template-areas:"main side"}
.sp-rp--vertical .sp-rp__side{grid-area:side}
.sp-rp--vertical .sp-rp__main{grid-area:main}
.sp-rp__ft{position:absolute;opacity:0;pointer-events:none}
.sp-rp__fbtn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border:1px solid rgba(0,0,0,.18);border-radius:999px;background:#fff;color:inherit;font-weight:600;font-size:.9em;cursor:pointer;transition:border-color .15s}
.sp-rp__fbtn:hover{border-color:rgba(0,0,0,.4)}
.sp-rp__fbtn--m,.sp-rp__x--m,.sp-rp__mdrawer{display:none}
.sp-rp__ft:focus-visible~.sp-rp__main .sp-rp__fbtn{outline:2px solid var(--sp-acc);outline-offset:2px}
.sp-rp__side{position:sticky;top:16px}
/* One shared top line: the sidebar heading and the toolbar have the same height and divider. */
.sp-rp__sh,.sp-rp__bar{box-sizing:border-box;min-height:52px;margin:0 0 18px;padding:0 0 12px;border-bottom:1px solid var(--sp-line)}
.sp-rp__sh{display:flex;align-items:flex-end;gap:8px}
.sp-rp__st{margin:0;font-weight:700;font-size:1.05em;letter-spacing:-.01em}
.sp-rp__clear{margin-left:auto;font-size:.85em;color:inherit;opacity:.75;text-decoration:underline;text-underline-offset:2px}
.sp-rp__clear:hover{opacity:1}
.sp-rp__g{padding:0 0 14px;margin:0 0 14px;border-bottom:1px solid var(--sp-line)}
.sp-rp__g:last-child{border-bottom:0}
.sp-rp__gt{display:flex;align-items:center;gap:8px;padding:2px 0;font-weight:600;font-size:.95em;cursor:pointer;list-style:none}
.sp-rp__gt::-webkit-details-marker,.sp-rp__dd summary::-webkit-details-marker,.sp-rp__more summary::-webkit-details-marker{display:none}
.sp-rp__gt::after{content:"";margin-left:auto;width:7px;height:7px;border:solid currentColor;border-width:0 1.5px 1.5px 0;transform:rotate(45deg) translateY(-2px);transition:transform .2s ease;opacity:.55}
.sp-rp__g[open]>.sp-rp__gt::after{transform:rotate(-135deg) translateY(-2px)}
.sp-rp__g[open]>.sp-rp__gt{margin-bottom:10px}
.sp-rp__pc{min-width:20px;padding:0 6px;border-radius:999px;background:var(--sp-acc);color:#fff;font-size:.72em;font-weight:700;line-height:20px;text-align:center}
.sp-rp__g ul,.sp-rp__ddp ul{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.sp-rp__more{margin-top:4px}
.sp-rp__more>summary{display:inline-block;cursor:pointer;font-size:.86em;font-weight:600;text-decoration:underline;text-underline-offset:2px;list-style:none;margin:4px 0}
.sp-rp__more[open]>summary{display:none}
.sp-rp__o{display:flex;align-items:center;gap:10px;margin:0 -6px;padding:5px 6px;border-radius:8px;text-decoration:none;color:inherit;font-size:.92em;transition:background .15s}
.sp-rp__o:hover{background:var(--sp-soft)}
.sp-rp__box{position:relative;flex:0 0 18px;width:18px;height:18px;border:1.5px solid rgba(0,0,0,.35);border-radius:5px;box-sizing:border-box;background:#fff;transition:background .15s,border-color .15s}
.sp-rp__o:hover .sp-rp__box{border-color:rgba(0,0,0,.6)}
.sp-rp__o.is-on .sp-rp__box{background:var(--sp-acc);border-color:var(--sp-acc)}
.sp-rp__o.is-on .sp-rp__box::after{content:"";position:absolute;left:5px;top:1.5px;width:4px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
.sp-rp__o.is-on .sp-rp__v{font-weight:600}
.sp-rp__v{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.sp-rp__n{min-width:22px;padding:0 6px;border-radius:999px;background:var(--sp-soft);font-size:.78em;line-height:20px;text-align:center;opacity:.85}
.sp-rp__hbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.sp-rp__dd{position:relative}
.sp-rp__dd>summary{display:flex;align-items:center;gap:8px;padding:8px 14px;border:1px solid rgba(0,0,0,.18);border-radius:999px;background:#fff;cursor:pointer;font-size:.9em;font-weight:600;list-style:none;transition:border-color .15s}
.sp-rp__dd>summary:hover,.sp-rp__dd[open]>summary{border-color:rgba(0,0,0,.45)}
.sp-rp__dd>summary::after{content:"";width:6px;height:6px;border:solid currentColor;border-width:0 1.5px 1.5px 0;transform:rotate(45deg) translateY(-2px);opacity:.6}
.sp-rp__ddp{position:absolute;z-index:20;top:calc(100% + 8px);left:0;min-width:240px;max-height:340px;overflow-y:auto;padding:10px 12px;border-radius:12px;background:#fff;color:#1a1a1a;box-shadow:0 0 0 1px rgba(0,0,0,.06),0 16px 40px rgba(0,0,0,.16)}
.sp-rp__drawer{position:fixed;z-index:1000;top:0;bottom:0;left:0;width:min(340px,88vw);overflow-y:auto;overscroll-behavior:contain;padding:18px 20px;box-sizing:border-box;background:#fff;color:#1a1a1a;box-shadow:0 0 40px rgba(0,0,0,.2);transform:translateX(-105%);visibility:hidden;transition:transform .34s cubic-bezier(.32,.72,0,1),visibility 0s linear .34s}
.sp-rp__ft:checked~.sp-rp__drawer{transform:none;visibility:visible;transition:transform .34s cubic-bezier(.32,.72,0,1),visibility 0s}
.sp-rp__shade{position:fixed;z-index:999;inset:0;background:rgba(0,0,0,.35);opacity:0;pointer-events:none;transition:opacity .3s ease}
.sp-rp__ft:checked~.sp-rp__shade{opacity:1;pointer-events:auto}
.sp-rp__x{margin-left:auto;font-size:1.6em;line-height:1;cursor:pointer;padding:0 4px}
.sp-rp__clear+.sp-rp__x{margin-left:8px}
.sp-rp__df{padding-top:12px}
@media (prefers-reduced-motion:reduce){.sp-rp__drawer,.sp-rp__shade,.sp-rp__gt::after,.sp-rp--vertical .sp-rp__side,.sp-card__img,.sp-rp__o{transition:none!important}}
.sp-rp__bar{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap}
.sp-rp__count{margin:0;font-size:.92em;opacity:.7}
.sp-rp__sort{margin:0 0 0 auto}
.sp-rp__sort label{display:flex;align-items:center;gap:8px;font-size:.9em}
.sp-rp__sort label span{opacity:.7}
.sp-rp__sort select{font:inherit;font-weight:600;padding:7px 32px 7px 14px;border-radius:999px;border:1px solid rgba(0,0,0,.18);background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath d='M2 3.5 5 6.5 8 3.5' fill='none' stroke='%23555' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 12px center;color:inherit;cursor:pointer;-webkit-appearance:none;appearance:none}
.sp-rp__chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.sp-rp__chip{display:inline-flex;align-items:center;gap:8px;padding:5px 12px;border-radius:999px;background:var(--sp-soft);color:inherit;text-decoration:none;font-size:.86em;font-weight:500;transition:background .15s}
.sp-rp__chip:hover{background:#e7e7ea}
.sp-rp__chip span:last-child{font-size:1.15em;line-height:1;opacity:.6}
.sp-grid{list-style:none;padding:0;margin:0;display:grid;gap:28px 20px;grid-template-columns:repeat(var(--sp-cols,4),minmax(0,1fr))}
.sp-card a{display:flex;flex-direction:column;gap:6px;text-decoration:none;color:inherit}
.sp-card__img{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;height:auto;background:var(--sp-soft,#f4f4f5);transition:transform .35s ease,box-shadow .35s ease}
.sp-card a:hover .sp-card__img{transform:translateY(-2px);box-shadow:0 10px 24px -12px rgba(0,0,0,.35)}
.sp-card__img--none{display:block}
.sp-card__t{margin-top:6px;font-weight:500;line-height:1.35;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.sp-card a:hover .sp-card__t{text-decoration:underline;text-underline-offset:2px}
.sp-card__fit{align-self:flex-start;padding:2px 8px;border-radius:999px;background:#ecfdf3;color:#15803d;font-size:.76em;font-weight:600}
.sp-card__p{font-weight:700;font-size:1.02em}
.sp-pager{display:flex;gap:10px;justify-content:center;align-items:center;margin-top:36px}
.sp-pager a{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border:1px solid rgba(0,0,0,.18);border-radius:999px;color:inherit;text-decoration:none;transition:border-color .15s}
.sp-pager a:hover{border-color:rgba(0,0,0,.45)}
.sp-pager span{font-size:.92em;opacity:.75;padding:0 6px}
@media (max-width:989px){.sp-rp--vertical{grid-template-columns:200px minmax(0,1fr);column-gap:20px}.sp-rp--vertical.sp-rp--right{grid-template-columns:minmax(0,1fr) 200px}.sp-grid{grid-template-columns:repeat(min(var(--sp-cols,4),3),minmax(0,1fr))}}
@media (max-width:749px){
.sp-rp--vertical,.sp-rp--vertical.sp-rp--right{grid-template-columns:minmax(0,1fr);grid-template-areas:"main"}
.sp-rp__fbtn--m{display:inline-flex}
.sp-rp__x--m{display:inline}
.sp-rp__mdrawer{display:block}
.sp-rp--horizontal .sp-rp__hbar{display:none}
.sp-rp--vertical .sp-rp__side{position:fixed;z-index:1000;top:0;bottom:0;left:0;width:min(340px,88vw);overflow-y:auto;overscroll-behavior:contain;padding:16px 20px;box-sizing:border-box;background:#fff;color:#1a1a1a;box-shadow:0 0 40px rgba(0,0,0,.2);transform:translateX(-105%);visibility:hidden;transition:transform .34s cubic-bezier(.32,.72,0,1),visibility 0s linear .34s}
.sp-rp--vertical .sp-rp__ft:checked~.sp-rp__side{transform:none;visibility:visible;transition:transform .34s cubic-bezier(.32,.72,0,1),visibility 0s}
.sp-rp--vertical .sp-rp__side .sp-rp__clear{margin-left:auto}
.sp-rp--vertical .sp-rp__side .sp-rp__clear+.sp-rp__x{margin-left:8px}
body:has(.sp-rp__ft:checked){overflow:hidden}
.sp-rp__ddp{min-width:200px}
.sp-grid{grid-template-columns:repeat(var(--sp-mcols,2),minmax(0,1fr));gap:12px}
}
</style>`;
