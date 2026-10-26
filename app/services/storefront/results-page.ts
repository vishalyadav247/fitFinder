// SpareFit's own results page (app proxy /apps/sparefit/results): Liquid that Shopify renders
// inside the shop's theme (specs/storefront.md › Results page tab). Results normally open on the
// theme's search page (proxy.search.tsx); this page is used when the merchant picks it under
// the search button's Button action, when nothing fits, or when the SKU list is too long for one search.
// Layout: search widget, title, then the filters (from product tags) on the left and the product
// grid on the right; on mobile the filters open as a drawer from a "Filters" button. Product cards come
// from Liquid's all_products (20 unique handles per page, so at most 20 per page), so prices,
// images and URLs are the live storefront's. The admin preview renders the same markup with
// static cards (resultsBody), so it matches the page by construction.
import type { StorefrontConfig } from "./config";
import type { ResultsPage } from "./query.server";
import {
  BADGE_TAG_COLORS,
  SHAPE_RADIUS,
  type BadgeTag,
  type Facet,
  type FilterPicks,
  type ResultsPageSettings,
  defaultResultsPage,
  SORTS,
  MIN_MORE,
  SAFE_LINK,
} from "./results-settings";

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
  if (/^[4-8]00$/.test(s.titleWeight ?? ""))
    parts.push(`font-weight:${s.titleWeight}`);
  // Mobile size as a variable the stylesheet uses under 750px.
  if (s.titleSizeMobile > 0)
    parts.push(`--sp-tsm:${Math.round(s.titleSizeMobile)}px`);
  if (/^#[0-9a-fA-F]{6}$/.test(s.titleColor))
    parts.push(`color:${s.titleColor}`);
  return parts.join(";");
}

/** The page heading when the merchant hasn't set one: "Parts that fit your vehicle". */
export const defaultPageTitle = (config: { things: string; noun: string }) =>
  `${capitalize(config.things)} that fit your ${config.noun}`;

type Card = (p: { handle: string; universal: boolean }) => string;

/** What a product card shows besides its image and title (Results page tab › Product cards). */
export interface CardParts {
  /** Picked tags (as written in the settings) this product has: shown as badges. */
  tagBadges: (handle: string) => BadgeTag[];
  sale: boolean;
  /** Built-in badge texts. */
  soldOutText: string;
  saleText: string;
  cart: boolean;
  /** The Add to cart button's text. */
  cartText: string;
  /** The second image under the first, shown on hover. */
  hover: boolean;
  fit: boolean;
  price: boolean;
  sku: boolean;
  compare: boolean;
  soldOut: boolean;
  vendor: boolean;
}

export const cardParts = (
  s: ResultsPageSettings,
  tagsByHandle: Record<string, string[]> = {},
): CardParts => ({
  tagBadges: (handle) => {
    const has = new Set(
      (tagsByHandle[handle] ?? []).map((t) => t.toLowerCase()),
    );
    return (s.badgeTags ?? []).filter(
      (b) => b.active !== false && has.has(b.tag.toLowerCase()),
    );
  },
  sale: s.badgeSale === true,
  soldOutText: s.soldOutLabel?.trim() || "Sold out",
  saleText: s.saleLabel?.trim() || "Sale",
  cart: s.cardCart === true,
  cartText: s.cartText?.trim() || "Add to cart",
  hover: s.imageHover === true,
  fit: s.cardFit !== false,
  price: s.cardPrice !== false,
  sku: s.cardSku === true,
  compare: s.cardCompare !== false,
  soldOut: s.cardSoldOut !== false,
  vendor: s.cardVendor === true,
});

const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = (v: string, fallback: string) => (HEX.test(v) ? v : fallback);

/** A tag badge in its colours (`esc` escapes the tag for the page or the preview). */
export const tagBadgeHtml = (b: BadgeTag, esc: (s: string) => string) =>
  `<span class="sp-card__tb" style="background:${hex(b.bg, BADGE_TAG_COLORS.bg)};color:${hex(b.color, BADGE_TAG_COLORS.color)}">${esc(b.label?.trim() || b.tag)}</span>`;

/** Card spacing, Add to cart button and badge looks as CSS variables on the page wrapper. */
const cardVars = (s: ResultsPageSettings) =>
  [
    `--sp-gap:${Math.max(0, Math.round(s.cardGap ?? 20))}px`,
    `--sp-mgap:${Math.max(0, Math.round(s.cardGapMobile ?? 12))}px`,
    `--sp-cbtn-r:${SHAPE_RADIUS[s.cartShape] ?? "999px"}`,
    HEX.test(s.cartBg) && `--sp-cbtn-bg:${s.cartBg}`,
    HEX.test(s.cartColor) && `--sp-cbtn-fg:${s.cartColor}`,
    `--sp-badge-r:${SHAPE_RADIUS[s.badgeShape] ?? "999px"}`,
    s.badgeSize > 0 && `--sp-badge-fs:${Math.round(s.badgeSize)}px`,
    /^[4-8]00$/.test(s.badgeWeight ?? "") && `--sp-badge-fw:${s.badgeWeight}`,
    `--sp-so-bg:${hex(s.soldOutBg, "#1A1A1A")}`,
    `--sp-so-fg:${hex(s.soldOutColor, "#FFFFFF")}`,
    `--sp-sale-bg:${hex(s.saleBg, "#B42318")}`,
    `--sp-sale-fg:${hex(s.saleColor, "#FFFFFF")}`,
    `--sp-price:${hex(s.priceColor, "#1A1A1A")}`,
    `--sp-was:${hex(s.comparePriceColor, "#1A1A1A")}`,
  ]
    .filter(Boolean)
    .map((v) => `;${v}`)
    .join("");

/** The card and layout looks set on the page wrapper (classes the stylesheet reads). */
const looks = (s: ResultsPageSettings) =>
  [
    s.imageFit === "contain" && "sp-rp--contain",
    s.imageHover && "sp-rp--hover",
    s.titleLines === "1" && "sp-rp--t1",
    s.titleLines === "full" && "sp-rp--tfull",
    s.cardAlign === "center" && "sp-rp--center",
    s.cartStyle === "outline" && "sp-rp--outline",
    !s.stickySide && "sp-rp--static",
  ]
    .filter(Boolean)
    .map((c) => ` ${c}`)
    .join("");

/** Image shape → aspect-ratio of the card image ("natural" keeps the image's own). */
const IMAGE_RATIO = {
  square: "1",
  portrait: "3 / 4",
  natural: "auto",
} as const;

/**
 * The card's button (Product cards › Show the Add to cart button), from Shopify's own availability
 * (product.available: tracked stock, "continue selling when out of stock" and untracked inventory):
 * one variant that can be bought → Add to cart (a cart form; the script adds it in place);
 * several variants or a subscription-only product → Choose options (the product page);
 * nothing can be bought → a disabled Sold out button.
 */
const cartButton = (text: string) => `
  {%- if sp_p.available -%}{%- if sp_p.variants_count == 1 and sp_p.requires_selling_plan == false -%}{%- assign sp_v = sp_p.selected_or_first_available_variant -%}<form method="post" action="{{ routes.cart_add_url }}" class="sp-card__cart"><input type="hidden" name="id" value="{{ sp_v.id }}"><input type="hidden" name="quantity" value="{{ sp_v.quantity_rule.min | default: 1 }}"><button type="submit" class="sp-card__btn">${t(text)}</button><span class="sp-card__msg" role="status"></span></form>{%- else -%}<a class="sp-card__btn sp-card__btn--alt" href="{{ sp_p.url }}">Choose options</a>{%- endif -%}{%- else -%}<button type="button" class="sp-card__btn" disabled>Sold out</button>{%- endif -%}`;

/** Live page card: the product read from all_products (price, stock, vendor and SKU live). */
const liquidCard =
  (fitsText: string, parts: CardParts): Card =>
  (p) => {
    if (!SAFE_HANDLE.test(p.handle)) return "";
    const price = parts.compare
      ? `{%- if sp_sv.compare_at_price > sp_sv.price -%}<span class="sp-card__p is-sale">{{ sp_sv.price | money }} <s class="sp-card__was">{{ sp_sv.compare_at_price | money }}</s></span>{%- else -%}<span class="sp-card__p">{{ sp_p.price | money }}</span>{%- endif -%}`
      : `<span class="sp-card__p">{{ sp_p.price | money }}</span>`;
    return `{%- assign sp_p = all_products['${p.handle}'] -%}{%- if sp_p.id -%}{%- assign sp_sv = sp_p.selected_or_first_available_variant -%}
<li class="sp-card"><a href="{{ sp_p.url }}">
  <span class="sp-card__media">{%- if sp_p.featured_image -%}{{ sp_p.featured_image | image_url: width: 480 | image_tag: loading: 'lazy', class: 'sp-card__img', alt: sp_p.title }}{%- else -%}<span class="sp-card__img sp-card__img--none"></span>{%- endif -%}${
    // The second image, shown on hover.
    (parts.hover
      ? `{%- if sp_p.images[1] -%}{{ sp_p.images[1] | image_url: width: 480 | image_tag: loading: 'lazy', class: 'sp-card__img sp-card__img--alt', alt: '' }}{%- endif -%}`
      : "") +
    // Badges: Sold out, Sale, then the picked tags this product has (3 at most, CSS).
    `<span class="sp-card__badges">${
      parts.soldOut
        ? `{%- unless sp_p.available -%}<span class="sp-card__so">${t(parts.soldOutText)}</span>{%- endunless -%}`
        : ""
    }${
      parts.sale
        ? `{%- if sp_sv.compare_at_price > sp_sv.price -%}<span class="sp-card__sale">${t(parts.saleText)}</span>{%- endif -%}`
        : ""
    }${parts
      .tagBadges(p.handle)
      .map((b) => tagBadgeHtml(b, t))
      .join("")}</span>`
  }</span>${
    parts.vendor
      ? `\n  {%- if sp_p.vendor != blank -%}<span class="sp-card__v">{{ sp_p.vendor | escape }}</span>{%- endif -%}`
      : ""
  }
  <span class="sp-card__t">{{ sp_p.title | escape }}</span>${
    parts.sku
      ? `\n  {%- assign sp_sku = sp_sv.sku -%}{%- if sp_sku != blank -%}<span class="sp-card__sku">SKU {{ sp_sku | escape }}</span>{%- endif -%}`
      : ""
  }${parts.fit ? `\n  <span class="sp-card__fit">&#10003; ${t(fitsText)}</span>` : ""}${
    parts.price ? `\n  ${price}` : ""
  }
</a>${parts.cart ? cartButton(parts.cartText) : ""}</li>{%- endif -%}`;
  };

export function resultsLiquid(view: ResultsView): string {
  const settings = { ...defaultResultsPage(), ...view.settings };
  return `${STYLE}${resultsBody(view, liquidCard(view.config.s.fitsText, cardParts(settings, view.results?.tagsByHandle)), true)}${SCRIPT}`;
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
  var pushed = false;
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
        if (push) { history.pushState({ sp: 1 }, "", url); pushed = true; }
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
  // Only addresses this script pushed: a theme's own hash links don't reload the results.
  window.addEventListener("popstate", function () { if (pushed) swap(location.href, false); });

  // Load more: the next page's products go under these, and its Load more replaces this one.
  // The address stays (a reload starts from the first page again).
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest(".sp-rp [data-sp-more]");
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var grid = document.querySelector(".sp-rp .sp-grid");
    var box = a.closest(".sp-more");
    if (!grid || !box) return;
    e.preventDefault();
    if (a.getAttribute("aria-busy")) return;
    a.setAttribute("aria-busy", "true");
    fetch(a.href, { credentials: "same-origin" })
      .then(function (r) { if (!r.ok) throw r; return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, "text/html");
        if (!doc.querySelector(".sp-rp")) throw doc;
        // A page whose products aren't on the Online Store has no cards: its Load more takes over.
        var cards = doc.querySelectorAll(".sp-rp .sp-grid > li");
        for (var i = 0; i < cards.length; i++) grid.appendChild(document.importNode(cards[i], true));
        var next = doc.querySelector(".sp-rp .sp-more");
        if (next) box.replaceWith(document.importNode(next, true));
        else box.remove();
      })
      .catch(function () { location.href = a.href; });
  });

  // Sort by on mouse / trackpad screens: a list that opens under the button, like the search
  // widget's dropdowns. Touch screens keep the native picker. Picking sets the select and fires
  // its change (the swap above). Rebuilt after every swap.
  var fine = window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches;
  function sortList() {
    if (!fine) return;
    var sel = document.querySelector(".sp-rp__sort select");
    if (!sel || sel.dataset.spDd) return;
    sel.dataset.spDd = "1";
    var wrap = document.createElement("div");
    wrap.className = "sp-rp-dd";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sp-rp-dd__btn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "Sort by");
    var list = document.createElement("ul");
    list.className = "sp-rp-dd__list";
    list.setAttribute("role", "listbox");
    list.hidden = true;
    var active = sel.selectedIndex;
    function paint() {
      btn.textContent = sel.options[sel.selectedIndex].text;
      list.innerHTML = "";
      Array.prototype.forEach.call(sel.options, function (o, i) {
        var li = document.createElement("li");
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(i === sel.selectedIndex));
        if (i === active) li.className = "is-active";
        li.textContent = o.text;
        li.addEventListener("mousedown", function (e) { e.preventDefault(); });
        li.addEventListener("click", function () { pick(i); });
        list.appendChild(li);
      });
    }
    function open() { active = sel.selectedIndex; paint(); list.hidden = false; btn.setAttribute("aria-expanded", "true"); }
    function close() { list.hidden = true; btn.setAttribute("aria-expanded", "false"); }
    function pick(i) {
      close();
      btn.focus();
      if (i === sel.selectedIndex) return;
      sel.selectedIndex = i;
      paint();
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    btn.addEventListener("click", function () { list.hidden ? open() : close(); });
    btn.addEventListener("blur", close);
    btn.addEventListener("keydown", function (e) {
      var n = sel.options.length;
      if (list.hidden) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
        return;
      }
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(n - 1, active + 1); paint(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); paint(); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(active); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    });
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(btn);
    wrap.appendChild(list);
    wrap.appendChild(sel);
    sel.classList.add("sp-rp-dd__native");
    sel.tabIndex = -1;
    sel.setAttribute("aria-hidden", "true");
    paint();
  }
  sortList();
  // Rebuilt after every swap, which only changes the results.
  var results = document.querySelector(".sp-results");
  if (results) new MutationObserver(sortList).observe(results, { childList: true, subtree: true });

  // Add to cart without leaving the page, then show it the way the theme does (2026-10-23):
  // 1. Dawn-style themes (Dawn and its forks): add with the cart drawer's own sections and hand the
  //    response to its renderContents(), as Dawn's product form does: the drawer opens updated and
  //    the count bubble re-renders.
  // 2. Horizon-style themes: Shopify.actions.updateCart and openCart (standard storefront actions).
  // 3. Any other theme: the Ajax Cart API, the cart events common themes listen for, the header
  //    count from /cart.js and the theme's cart drawer if one is on the page. Never a page reload.
  // Without JavaScript the form posts and the shopper lands on the cart.
  var root = (window.Shopify && Shopify.routes && Shopify.routes.root) || "/";
  function dawnCart() {
    var els = document.querySelectorAll("cart-drawer, cart-notification");
    for (var i = 0; i < els.length; i++) {
      if (typeof els[i].renderContents === "function" && typeof els[i].getSectionsToRender === "function") return els[i];
    }
    return null;
  }
  function horizonActions() {
    var a = window.Shopify && Shopify.actions;
    var icon = document.querySelector("cart-icon");
    return a && typeof a.updateCart === "function" && typeof a.openCart === "function" &&
      icon && typeof icon.renderCartBubble === "function" ? a : null;
  }
  function readJson(r) {
    return r.json().then(function (body) { if (!r.ok) throw body; return body; });
  }
  function ajaxAdd(form, sections) {
    var data = new FormData(form);
    if (sections && sections.length) {
      data.append("sections", sections.join(","));
      data.append("sections_url", root);
    }
    return fetch(form.getAttribute("action") + ".js", {
      method: "POST", body: data, credentials: "same-origin", headers: { Accept: "application/json" }
    }).then(readJson);
  }
  function announce(item, btn) {
    // Bubbles from <html>, so listeners on html, document or window all hear it.
    var html = document.documentElement;
    ["cart:refresh", "cart:build", "cart:updated", "cart:change", "theme:cart:refresh"].forEach(function (n) {
      html.dispatchEvent(new CustomEvent(n, { bubbles: true, detail: { item: item } }));
    });
    html.dispatchEvent(new CustomEvent("ajaxProduct:added", { bubbles: true, detail: { product: item, addToCartBtn: btn } }));
  }
  var COUNT = "[data-cart-count],[data-cart-item-count],[data-header-cart-count],.cart-count,.cart-count-bubble span[aria-hidden],.cart-item-count,.cart-link__bubble-num,.js-cart-count,.header__cart-count,.CartCount,#CartCount,.cart_count,.cart-counter,cart-count";
  function setCount(n) {
    var els = document.querySelectorAll(COUNT);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.hasAttribute("data-cart-count")) el.setAttribute("data-cart-count", n);
      if (el.children.length) continue;
      var text = el.textContent.trim();
      if (text && !/^[0-9]+[+]?$/.test(text)) continue;
      el.textContent = String(n);
      [el, el.parentElement].forEach(function (x) {
        if (!x || n < 1) return;
        x.hidden = false;
        x.classList.remove("hidden", "hide", "is-hidden", "is-empty");
      });
    }
  }
  function drawerLooksOpen() {
    var cls = document.documentElement.className + " " + document.body.className;
    return /drawer-open|drawer--open|cart-open|cart-drawer-open/i.test(cls) ||
      !!document.querySelector("cart-drawer.active, cart-drawer[open], .drawer.is-open, .drawer--is-open, [data-cart-drawer][aria-hidden='false'], #CartDrawer.is-open, #CartDrawer[open], dialog[open][id*='art']");
  }
  function openDrawer() {
    if (drawerLooksOpen()) return;
    var els = document.querySelectorAll("cart-drawer, #CartDrawer, #cart-drawer, [data-cart-drawer], #mini-cart, mini-cart, side-cart, cart-drawer-component");
    for (var i = 0; i < els.length; i++) {
      var fn = els[i].open || els[i].show;
      if (typeof fn === "function") { try { fn.call(els[i]); return; } catch (e) {} }
    }
    var trigger = document.querySelector("[aria-controls='CartDrawer'],[aria-controls='cart-drawer'],[aria-controls='mini-cart'],[data-drawer-trigger='cart'],.js-drawer-open-cart,.js-cart-drawer-open,[data-cart-drawer-toggle]");
    if (trigger) trigger.click();
  }
  function otherTheme(form, btn) {
    return ajaxAdd(form).then(function (item) {
      announce(item, btn);
      fetch(root + "cart.js", { credentials: "same-origin", headers: { Accept: "application/json" } })
        .then(readJson)
        .then(function (cart) { setCount(cart.item_count); })
        .catch(function () {});
      // Give the theme a moment to open its own drawer on the events first.
      setTimeout(openDrawer, 300);
    });
  }
  function addToCart(form, btn) {
    var dawn = dawnCart();
    if (dawn) {
      var ids = dawn.getSectionsToRender().map(function (s) { return s.id; });
      return ajaxAdd(form, ids).then(function (item) {
        dawn.classList.remove("is-empty");
        dawn.renderContents(item);
        announce(item, btn);
      });
    }
    var actions = horizonActions();
    if (actions) {
      return actions.updateCart(
        { lines: [{ merchandiseId: form.elements.id.value, quantity: Number(form.elements.quantity.value) || 1 }] },
        { event: { context: "product" } }
      ).then(function (result) {
        if (result && result.userErrors && result.userErrors.length) throw { description: result.userErrors[0].message };
        return actions.openCart();
      });
    }
    return otherTheme(form, btn);
  }
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form.classList || !form.classList.contains("sp-card__cart")) return;
    e.preventDefault();
    var btn = form.querySelector("button");
    var msg = form.querySelector(".sp-card__msg");
    if (btn.disabled) return;
    var label = btn.textContent;
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    msg.textContent = "";
    addToCart(form, btn)
      .then(function () {
        btn.textContent = "Added " + String.fromCharCode(10003);
        btn.classList.add("is-done");
        setTimeout(function () {
          btn.textContent = label;
          btn.classList.remove("is-done");
          btn.disabled = false;
        }, 2000);
      })
      .catch(function (err) {
        msg.textContent = (err && (err.description || err.message)) || "Couldn't add it. Try again.";
        btn.disabled = false;
      })
      .then(function () { btn.removeAttribute("aria-busy"); });
  });
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

const FILTER_ICON = `<svg class="sp-rp__ico" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M3 5.5h14M5.5 10h9M8 14.5h4"/></svg>`;
const SORT_ICON = `<svg class="sp-rp__ico" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 4v12M3.5 13l3 3 3-3M13.5 16V4M10.5 7l3-3 3 3"/></svg>`;

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
  // A round filter icon (its name for screen readers; the number of picked tags as a badge).
  const button = (mobileOnly: boolean) =>
    `<label for="sp-rp-ft" class="sp-rp__fbtn${mobileOnly ? " sp-rp__fbtn--m" : ""}" title="${label}">${FILTER_ICON}<span class="sp-rp-vh">${label}</span>${picked ? `<span class="sp-rp__fbadge" aria-hidden="true">${picked}</span>` : ""}</label>`;
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
  return `<form class="sp-rp__sort" method="get"${live ? ` action="${t(config.proxy)}/results"` : ""}>${hidden}<label><span class="sp-rp__sorttxt">Sort by</span> ${SORT_ICON}<select name="sort" aria-label="Sort by">${options}</select></label>${live ? '<noscript><button type="submit">Sort</button></noscript>' : ""}</form>`;
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
  const own = settings.pageWidth !== "theme";
  const custom = settings.pageWidth === "custom";
  const head = `<div class="${own ? "sp-results-outer" : "page-width sp-results-outer"}"><div class="sp-results${own ? " sp-results--full" : ""}"${custom ? ` style="--sp-pw:${Math.round(settings.pageMaxWidth)}px"` : ""} data-sp-results data-sp-picks="${t(JSON.stringify(view.picks))}">
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
    ? `<p class="sp-results__empty">${t(picked ? `No ${config.things} match these filters.` : settings.emptyText.trim() || config.s.noResults)}${
        picked
          ? ` <a href="${t(href({ ...state, filterPicks: {}, page: 1 }))}" rel="nofollow">Clear all</a>`
          : ""
      }</p>${
        !picked &&
        settings.emptyButton.trim() &&
        SAFE_LINK.test(settings.emptyUrl)
          ? `<p class="sp-results__emptycta"><a class="sp-results__emptybtn" href="${t(settings.emptyUrl)}">${t(settings.emptyButton.trim())}</a></p>`
          : ""
      }`
    : "";
  // Load more: the next page's products are added under these (script); without scripts the
  // link opens the next page.
  const shown = Math.min(results.total, results.page * results.products.length);
  const more =
    results.page < results.pageCount
      ? `<div class="sp-more"><p class="sp-more__n">${t(`Showing ${shown.toLocaleString("en-US")} of ${results.total.toLocaleString("en-US")}`)}</p><a class="sp-more__btn" href="${t(href({ ...state, page: results.page + 1 }))}" rel="next" data-sp-more>Load more</a></div>`
      : "";
  const pager =
    settings.paging === "more"
      ? more
      : results.pageCount > 1
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
  <div class="sp-rp ${filters ? `sp-rp--${settings.filterLayout}${settings.filterLayout === "vertical" && settings.filterSide === "right" ? " sp-rp--right" : ""}` : "sp-rp--nofilters"}${looks(settings)}" style="--sp-cols:${settings.columns};--sp-mcols:${settings.mobileColumns};--sp-acc:${t(config.s.btn)}${cardVars(settings)};--sp-ar:${IMAGE_RATIO[settings.cardImage] ?? "1"}">
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

/**
 * The toolbar as one line: filter icon left, result count in the middle, sort icon right (picked
 * tags below). Used on mobile and by the drawer layout, where the filter button shows. The sort
 * select lies invisibly over its icon (the device's own picker), or the script's list button does.
 */
function compactBar(p: string): string {
  return `${p} .sp-rp__bar{display:grid;grid-template-columns:44px minmax(0,1fr) 44px;align-items:center;gap:10px 12px;min-height:0}
${p} .sp-rp__fbtn{grid-column:1;grid-row:1}
${p} .sp-rp__count{grid-column:2;grid-row:1;text-align:center}
${p} .sp-rp__sort{grid-column:3;grid-row:1;justify-self:end;margin:0}
${p} .sp-rp__chips{grid-column:1/-1;grid-row:2;justify-content:center}
${p} .sp-rp__sort label{position:relative;display:grid;place-items:center;width:40px;height:40px;box-sizing:border-box;gap:0;border:1px solid rgba(0,0,0,.18);border-radius:999px;background:#fff;cursor:pointer}
${p} .sp-rp__sorttxt{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
${p} .sp-rp__sort .sp-rp__ico{display:block;pointer-events:none}
${p} .sp-rp__sort select{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;opacity:0;cursor:pointer}
${p} .sp-rp-dd{position:static}
${p} .sp-rp-dd__btn{position:absolute;inset:0;min-width:0;padding:0;border:0;border-radius:999px;background:transparent;color:transparent;font-size:0}
${p} .sp-rp-dd__btn:focus-visible{outline:2px solid var(--sp-acc);outline-offset:2px}
${p} .sp-rp-dd__list{min-width:180px}`;
}

// Inline, so the page has its layout even when the app embed (and its stylesheet) is off.
export const STYLE = `<style>
.sp-results{box-sizing:border-box;width:min(100%,var(--narrow-page-width,1440px),100vw - 80px);margin-inline:auto;padding-top:24px;padding-bottom:48px}
.page-width-normal .sp-results{width:min(100%,var(--normal-page-width,1920px),100vw - 80px)}
.sp-results.sp-results--full{width:min(100%,var(--sp-pw,100vw),100vw - 80px)}
@media (max-width:749px){.sp-results{width:min(100%,100vw - 40px)}.page-width-normal .sp-results{width:min(100%,100vw - 40px)}.sp-results.sp-results--full{width:min(100%,100vw - 40px)}}
.sp-results__title{margin:20px 0 16px}
@media (max-width:749px){.sp-results__title[style*="--sp-tsm:"]{font-size:var(--sp-tsm)!important}}
.sp-results__empty{margin:16px 0}
.sp-rp{--sp-acc:#1a1a1a;--sp-line:rgba(0,0,0,.09);--sp-soft:#f4f4f5;display:grid;grid-template-columns:minmax(0,1fr);gap:20px;align-items:start}
.sp-rp--vertical{grid-template-columns:250px minmax(0,1fr);grid-template-areas:"side main";column-gap:40px}
.sp-rp--vertical.sp-rp--right{grid-template-columns:minmax(0,1fr) 250px;grid-template-areas:"main side"}
.sp-rp--vertical .sp-rp__side{grid-area:side}
.sp-rp--vertical .sp-rp__main{grid-area:main}
.sp-rp__ft{position:absolute;opacity:0;pointer-events:none}
.sp-rp__fbtn{position:relative;display:inline-grid;place-items:center;width:40px;height:40px;box-sizing:border-box;padding:0;border:1px solid rgba(0,0,0,.18);border-radius:999px;background:#fff;color:inherit;cursor:pointer;transition:border-color .15s}
.sp-rp__fbadge{position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:999px;background:var(--sp-acc,#1a1a1a);color:#fff;font-size:11px;font-weight:700;line-height:18px;text-align:center}
.sp-rp-vh{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.sp-rp__ico{display:block}
.sp-rp__sort .sp-rp__ico{display:none}
${compactBar(".sp-rp--drawer")}
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
@media (prefers-reduced-motion:reduce){.sp-rp__drawer,.sp-rp__shade,.sp-rp__gt::after,.sp-rp--vertical .sp-rp__side,.sp-card__img,.sp-card,.sp-rp__o{transition:none!important}}
.sp-rp__bar{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap}
.sp-rp__count{margin:0;font-size:.92em;opacity:.7}
.sp-rp__sort{margin:0 0 0 auto}
.sp-rp__sort label{display:flex;align-items:center;gap:8px;font-size:.9em}
.sp-rp__sort label span{opacity:.7}
.sp-rp__sort select{font:inherit;font-weight:600;padding:7px 32px 7px 14px;border-radius:999px;border:1px solid rgba(0,0,0,.18);background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath d='M2 3.5 5 6.5 8 3.5' fill='none' stroke='%23555' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 12px center;color:inherit;cursor:pointer;-webkit-appearance:none;appearance:none}
.sp-rp__chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.sp-rp-dd{position:relative}
.sp-rp-dd__native{display:none}
.sp-rp-dd__btn{display:inline-flex;align-items:center;min-width:140px;padding:7px 32px 7px 14px;border:1px solid rgba(0,0,0,.18);border-radius:999px;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath d='M2 3.5 5 6.5 8 3.5' fill='none' stroke='%23555' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") no-repeat right 12px center;color:inherit;font:inherit;font-weight:600;text-align:left;cursor:pointer;transition:border-color .15s}
.sp-rp-dd__btn:hover,.sp-rp-dd__btn[aria-expanded="true"]{border-color:rgba(0,0,0,.45)}
.sp-rp-dd__btn:focus-visible{outline:2px solid var(--sp-acc);outline-offset:2px}
.sp-rp-dd__list{position:absolute;z-index:30;top:calc(100% + 6px);right:0;min-width:100%;box-sizing:border-box;margin:0;padding:4px;list-style:none;border-radius:12px;background:#fff;color:#1a1a1a;box-shadow:0 0 0 1px rgba(0,0,0,.06),0 12px 32px rgba(0,0,0,.14)}
.sp-rp-dd__list[hidden]{display:none}
.sp-rp-dd__list li{padding:8px 12px;border-radius:8px;white-space:nowrap;cursor:pointer;font-size:.92em}
.sp-rp-dd__list li.is-active,.sp-rp-dd__list li:hover{background:var(--sp-soft)}
.sp-rp-dd__list li[aria-selected="true"]{font-weight:600}
.sp-rp__chip{display:inline-flex;align-items:center;gap:8px;padding:5px 12px;border-radius:999px;background:var(--sp-soft);color:inherit;text-decoration:none;font-size:.86em;font-weight:500;transition:background .15s}
.sp-rp__chip:hover{background:#e7e7ea}
.sp-rp__chip span:last-child{font-size:1.15em;line-height:1;opacity:.6}
.sp-grid{list-style:none;padding:0;margin:0;display:grid;gap:var(--sp-gap,20px);grid-template-columns:repeat(var(--sp-cols,4),minmax(0,1fr))}
.sp-card{display:flex;flex-direction:column;gap:10px;padding:0 0 14px;border-radius:5px;overflow:hidden;background:#fff;color:#1a1a1a;box-shadow:0 1px 3px rgba(0,0,0,.08),0 6px 16px -8px rgba(0,0,0,.16);transition:box-shadow .3s ease}
.sp-card:hover{box-shadow:0 2px 5px rgba(0,0,0,.09),0 10px 22px -10px rgba(0,0,0,.2)}
.sp-card>a{flex:1;display:flex;flex-direction:column;gap:6px;text-decoration:none;color:inherit}
.sp-card__cart{margin:0;display:flex;flex-direction:column;gap:4px}
.sp-card__btn{display:block;width:100%;box-sizing:border-box;padding:10px 12px;border:0;border-radius:var(--sp-cbtn-r,999px);background:var(--sp-cbtn-bg,var(--sp-acc,#1a1a1a));color:var(--sp-cbtn-fg,#fff);font:inherit;font-size:.9em;font-weight:600;text-align:center;text-decoration:none;cursor:pointer;transition:filter .15s,opacity .15s}
.sp-card__btn:hover{filter:brightness(.9)}
.sp-card__btn--alt{background:transparent;color:inherit;box-shadow:inset 0 0 0 1px currentColor}
.sp-card__btn[disabled]:hover{filter:none}
.sp-card__btn--alt:hover{filter:none;background:var(--sp-soft,#f4f4f5)}
.sp-card__btn[disabled]{cursor:default;opacity:.5;filter:none}
.sp-card__btn[aria-busy="true"]{opacity:.7}
.sp-card__btn.is-done{background:#15803d;opacity:1}
.sp-card__msg{font-size:.78em;color:#b42318}
.sp-card__msg:empty{display:none}
.sp-card__media{position:relative;display:block}
.sp-card>a>:not(.sp-card__media),.sp-card>.sp-card__cart,.sp-card>.sp-card__btn{margin-inline:12px}
.sp-card>.sp-card__btn{width:auto}
.sp-card__img{display:block;width:100%;aspect-ratio:var(--sp-ar,1);object-fit:cover;border-radius:0;height:auto;background:var(--sp-soft,#f4f4f5)}
.sp-card__img--none{display:block;aspect-ratio:var(--sp-ar,1)}
.sp-rp[style*="--sp-ar:auto"] .sp-card__img--none{aspect-ratio:1}
.sp-card__t{margin-top:6px;font-weight:500;line-height:1.35;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;min-height:2.7em}
.sp-card__fit{align-self:flex-start;padding:2px 8px;border-radius:999px;background:#ecfdf3;color:#15803d;font-size:.76em;font-weight:600}
.sp-card__p{font-weight:700;font-size:1.02em;color:var(--sp-price,#1a1a1a)}
.sp-card__sku{font-size:.8em;opacity:.65;letter-spacing:.01em}
.sp-card__v{margin-top:6px;font-size:.74em;font-weight:600;letter-spacing:.06em;text-transform:uppercase;opacity:.6}
.sp-card__v+.sp-card__t{margin-top:0}
.sp-card__was{margin-left:6px;font-size:.84em;font-weight:500;color:var(--sp-was,#1a1a1a)}
.sp-card__badges{position:absolute;top:10px;left:10px;right:10px;display:flex;flex-wrap:wrap;gap:6px;pointer-events:none}
.sp-card__badges>span:nth-child(n+4){display:none}
.sp-card__so,.sp-card__sale,.sp-card__tb{padding:3px 9px;border-radius:var(--sp-badge-r,999px);font-size:var(--sp-badge-fs,.74em);font-weight:var(--sp-badge-fw,600);line-height:1.4;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.sp-card__so{background:var(--sp-so-bg,#1a1a1a);color:var(--sp-so-fg,#fff)}
.sp-card__sale{background:var(--sp-sale-bg,#b42318);color:var(--sp-sale-fg,#fff)}
.sp-card__tb{box-shadow:0 0 0 1px rgba(0,0,0,.1)}
.sp-rp--static .sp-rp__side{position:static}
.sp-rp--contain .sp-card__img{object-fit:contain;background:#fff}
.sp-card__img--alt{position:absolute;inset:0;height:100%;opacity:0;transition:opacity .4s ease}
@media (hover:hover){.sp-card>a:hover .sp-card__img--alt{opacity:1}}
.sp-rp--t1 .sp-card__t{-webkit-line-clamp:1;min-height:1.35em}
.sp-rp--tfull .sp-card__t{display:block;-webkit-line-clamp:unset;overflow:visible;min-height:0}
.sp-rp--center .sp-card>a{align-items:center;text-align:center}
.sp-rp--center .sp-card>a>:not(.sp-card__media){max-width:calc(100% - 24px);box-sizing:border-box}
.sp-rp--center .sp-card__media{align-self:stretch}
.sp-rp--center .sp-card__fit{align-self:center}
.sp-rp--outline .sp-card__btn:not(.sp-card__btn--alt){background:transparent;color:var(--sp-cbtn-bg,var(--sp-acc,#1a1a1a));box-shadow:inset 0 0 0 1.5px var(--sp-cbtn-bg,var(--sp-acc,#1a1a1a))}
.sp-rp--outline .sp-card__btn:not(.sp-card__btn--alt):not([disabled]):hover{filter:none;background:var(--sp-cbtn-bg,var(--sp-acc,#1a1a1a));color:var(--sp-cbtn-fg,#fff)}
.sp-rp--outline .sp-card__btn.is-done{background:#15803d;color:#fff;box-shadow:none}
.sp-results__emptycta{margin-top:14px}
.sp-results__emptybtn{display:inline-block;padding:10px 20px;border-radius:999px;background:var(--sp-acc,#1a1a1a);color:#fff;text-decoration:none;font-weight:600}
.sp-results__emptybtn:hover{filter:brightness(1.1)}
.sp-more{display:flex;flex-direction:column;align-items:center;gap:12px;margin-top:36px}
.sp-more__n{margin:0;font-size:.9em;opacity:.7}
.sp-more__btn{display:inline-flex;align-items:center;justify-content:center;min-width:180px;padding:11px 24px;border-radius:999px;box-shadow:inset 0 0 0 1.5px currentColor;color:inherit;text-decoration:none;font-weight:600;transition:background .15s}
.sp-more__btn:hover{background:var(--sp-soft,#f4f4f5)}
.sp-more__btn[aria-busy="true"]{opacity:.6;pointer-events:none}
.sp-pager{display:flex;gap:10px;justify-content:center;align-items:center;margin-top:36px}
.sp-pager a{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border:1px solid rgba(0,0,0,.18);border-radius:999px;color:inherit;text-decoration:none;transition:border-color .15s}
.sp-pager a:hover{border-color:rgba(0,0,0,.45)}
.sp-pager span{font-size:.92em;opacity:.75;padding:0 6px}
@media (max-width:989px){.sp-rp--vertical{grid-template-columns:200px minmax(0,1fr);column-gap:20px}.sp-rp--vertical.sp-rp--right{grid-template-columns:minmax(0,1fr) 200px}.sp-grid{grid-template-columns:repeat(min(var(--sp-cols,4),3),minmax(0,1fr))}}
@media (max-width:749px){
.sp-rp--vertical,.sp-rp--vertical.sp-rp--right{grid-template-columns:minmax(0,1fr);grid-template-areas:"main"}
.sp-rp__fbtn--m{display:inline-grid}
${compactBar(".sp-rp")}
.sp-rp__x--m{display:inline}
.sp-rp__mdrawer{display:block}
.sp-rp--horizontal .sp-rp__hbar{display:none}
.sp-rp--vertical .sp-rp__side{position:fixed;z-index:1000;top:0;bottom:0;left:0;width:min(340px,88vw);overflow-y:auto;overscroll-behavior:contain;padding:16px 20px;box-sizing:border-box;background:#fff;color:#1a1a1a;box-shadow:0 0 40px rgba(0,0,0,.2);transform:translateX(-105%);visibility:hidden;transition:transform .34s cubic-bezier(.32,.72,0,1),visibility 0s linear .34s}
.sp-rp--vertical .sp-rp__ft:checked~.sp-rp__side{transform:none;visibility:visible;transition:transform .34s cubic-bezier(.32,.72,0,1),visibility 0s}
.sp-rp--vertical .sp-rp__side .sp-rp__clear{margin-left:auto}
.sp-rp--vertical .sp-rp__side .sp-rp__clear+.sp-rp__x{margin-left:8px}
body:has(.sp-rp__ft:checked){overflow:hidden}
.sp-rp__ddp{min-width:200px}
.sp-grid{grid-template-columns:repeat(var(--sp-mcols,2),minmax(0,1fr));gap:var(--sp-mgap,12px)}
}
</style>`;
