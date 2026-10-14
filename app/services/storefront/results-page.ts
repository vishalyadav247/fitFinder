// SpareFit's own results page (app proxy /apps/sparefit/results): Liquid that Shopify renders
// inside the shop's theme. Results normally open on the theme's search page (proxy.search.tsx);
// this page is the fallback when nothing fits or the SKU list is too long for one search
// (specs/storefront.md › Results).
// Product cards come from Liquid's all_products (20 unique handles per page, hence 16 per page),
// so prices, images and URLs are the live storefront's. The search widget on top is filled in by
// the app embed's script (data-sp-search), prefilled with this page's picks.
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
  const head = `<div class="sp-results page-width" data-sp-results data-sp-picks="${t(JSON.stringify(picks))}">
  <div class="sp-search-wrap" data-sp-search data-sp-context="results"></div>
  <h1 class="sp-results__title">${t(`${capitalize(config.things)} that fit your ${config.noun}`)}</h1>
  ${label ? `<p class="sp-results__sel">${t(label)}</p>` : ""}`;
  if (!complete || !results) {
    return `${STYLE}${head}
  <p class="sp-results__empty">${t(`Select your ${config.noun} to see the ${config.things} that fit.`)}</p>
</div>`;
  }
  const cards = results.products
    .filter((p) => SAFE_HANDLE.test(p.handle))
    .map(
      (
        p,
      ) => `{%- assign sp_p = all_products['${p.handle}'] -%}{%- if sp_p.id -%}
<li class="sp-card"><a href="{{ sp_p.url }}">
  {%- if sp_p.featured_image -%}{{ sp_p.featured_image | image_url: width: 480 | image_tag: loading: 'lazy', class: 'sp-card__img', alt: sp_p.title }}{%- else -%}<span class="sp-card__img sp-card__img--none"></span>{%- endif -%}
  <span class="sp-card__t">{{ sp_p.title | escape }}</span>
  <span class="sp-card__fit">&#10003; ${t(s.fitsText)}</span>
  <span class="sp-card__p">{{ sp_p.price | money }}</span>
</a></li>{%- endif -%}`,
    )
    .join("\n");
  const empty = !results.products.length
    ? `<p class="sp-results__empty">${t(s.noResults)}</p>`
    : "";
  const pager =
    results.pageCount > 1
      ? `<nav class="sp-pager" aria-label="Pages">${
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
  <div data-sp-ask-save></div>
  ${cards ? `<ul class="sp-grid">${cards}</ul>` : ""}
  ${empty}
  ${pager}
</div>`;
}

// Inline, so the page has a grid even when the app embed (and its stylesheet) is off.
const STYLE = `<style>
.sp-results{padding-top:24px;padding-bottom:48px}
.sp-results__title{margin:20px 0 4px}
.sp-results__sel{margin:0 0 16px;opacity:.75}
.sp-results__empty{margin:16px 0}
.sp-grid{list-style:none;padding:0;margin:0;display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}
.sp-card a{display:flex;flex-direction:column;gap:4px;text-decoration:none;color:inherit}
.sp-card__img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;height:auto}
.sp-card__img--none{display:block;background:rgba(0,0,0,.06)}
.sp-card__fit{font-size:.85em;color:#15803D}
.sp-card__p{font-weight:700}
.sp-pager{display:flex;gap:16px;justify-content:center;align-items:center;margin-top:24px}
</style>`;
