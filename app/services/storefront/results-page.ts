// FitFinder's own results page (app proxy /apps/fitfinder/results): Liquid that Shopify renders
// inside the shop's theme. Results normally open on the theme's search page (proxy.search.tsx);
// this page is the fallback when nothing fits or the SKU list is too long for one search
// (specs/storefront.md › Results).
// Product cards come from Liquid's all_products (20 unique handles per page, hence 16 per page),
// so prices, images and URLs are the live storefront's. The search widget on top is filled in by
// the app embed's script (data-ff-search), prefilled with this page's picks.
import type { StorefrontConfig } from "./config";
import type { ResultsPage } from "./query.server";

export interface ResultsView {
  config: StorefrontConfig;
  /** field id → picked value */
  picks: Record<string, string>;
  label: string;
  complete: boolean;
  results: ResultsPage | null;
  /** links to other pages of these results */
  pageHref: (page: number) => string;
}

/** Text inside Liquid output: HTML-escaped, and braces escaped so it can't start a Liquid tag. */
export function escapeLiquidText(value: string): string {
  return value.replace(/[&<>"'{}%]/g, (c) => `&#${c.charCodeAt(0)};`);
}

const t = escapeLiquidText;

// Characters that would break out of a Liquid string literal or tag.
const SAFE_HANDLE = /^[^'"{}%<>\s\\]+$/;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function resultsLiquid({
  config,
  picks,
  label,
  complete,
  results,
  pageHref,
}: ResultsView): string {
  const { s } = config;
  const head = `<div class="ff-results page-width" data-ff-results data-ff-picks="${t(JSON.stringify(picks))}">
  <div class="ff-search-wrap" data-ff-search data-ff-context="results"></div>
  <h1 class="ff-results__title">${t(`${capitalize(config.things)} that fit your ${config.noun}`)}</h1>
  ${label ? `<p class="ff-results__sel">${t(label)}</p>` : ""}`;
  if (!complete || !results) {
    return `${STYLE}${head}
  <p class="ff-results__empty">${t(`Select your ${config.noun} to see the ${config.things} that fit.`)}</p>
</div>`;
  }
  const collections = results.collections.length
    ? `<ul class="ff-colls">${results.collections
        .map(
          (c) =>
            `<li><a class="ff-coll" href="{{ routes.collections_url }}/${encodeURIComponent(c.handle)}">${t(c.title)} &rarr;</a></li>`,
        )
        .join("")}</ul>`
    : "";
  const cards = results.products
    .filter((p) => SAFE_HANDLE.test(p.handle))
    .map(
      (
        p,
      ) => `{%- assign ff_p = all_products['${p.handle}'] -%}{%- if ff_p.id -%}
<li class="ff-card"><a href="{{ ff_p.url }}">
  {%- if ff_p.featured_image -%}{{ ff_p.featured_image | image_url: width: 480 | image_tag: loading: 'lazy', class: 'ff-card__img', alt: ff_p.title }}{%- else -%}<span class="ff-card__img ff-card__img--none"></span>{%- endif -%}
  <span class="ff-card__t">{{ ff_p.title | escape }}</span>
  <span class="ff-card__fit">&#10003; ${t(s.fitsText)}</span>
  <span class="ff-card__p">{{ ff_p.price | money }}</span>
</a></li>{%- endif -%}`,
    )
    .join("\n");
  const empty =
    !results.products.length && !results.collections.length
      ? `<p class="ff-results__empty">${t(s.noResults)}</p>`
      : "";
  const pager =
    results.pageCount > 1
      ? `<nav class="ff-pager" aria-label="Pages">${
          results.page > 1
            ? `<a href="${t(pageHref(results.page - 1))}" rel="prev">&larr;</a>`
            : ""
        }<span>${results.page} / ${results.pageCount}</span>${
          results.page < results.pageCount
            ? `<a href="${t(pageHref(results.page + 1))}" rel="next">&rarr;</a>`
            : ""
        }</nav>`
      : "";
  return `${STYLE}${head}
  <div data-ff-ask-save></div>
  ${collections}
  ${cards ? `<ul class="ff-grid">${cards}</ul>` : ""}
  ${empty}
  ${pager}
</div>`;
}

// Inline, so the page has a grid even when the app embed (and its stylesheet) is off.
const STYLE = `<style>
.ff-results{padding-top:24px;padding-bottom:48px}
.ff-results__title{margin:20px 0 4px}
.ff-results__sel{margin:0 0 16px;opacity:.75}
.ff-results__empty{margin:16px 0}
.ff-colls{list-style:none;padding:0;margin:0 0 16px;display:flex;flex-wrap:wrap;gap:8px}
.ff-coll{display:inline-block;padding:8px 14px;border:1px solid rgba(0,0,0,.15);border-radius:999px;text-decoration:none}
.ff-grid{list-style:none;padding:0;margin:0;display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}
.ff-card a{display:flex;flex-direction:column;gap:4px;text-decoration:none;color:inherit}
.ff-card__img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;height:auto}
.ff-card__img--none{display:block;background:rgba(0,0,0,.06)}
.ff-card__fit{font-size:.85em;color:#15803D}
.ff-card__p{font-weight:700}
.ff-pager{display:flex;gap:16px;justify-content:center;align-items:center;margin-top:24px}
</style>`;
