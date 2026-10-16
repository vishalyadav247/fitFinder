// sp-embed.js (app embed, every page): My Selection, the [sparefit-table] code in theme tabs
// (filled by sp-product.js),
// a clean search box on the theme's search page after a SpareFit search, and the search bundle
// for SpareFit's own results page (which has no block to load it).
import { boot, clearSkuQuery, each } from "./core.js";
import { initMySelection } from "./my-selection.js";
import { markTableCode } from "./product.js";

/** A block brings its own script and stylesheet; without one, the embed adds both. */
function need(flag, src, css) {
  if (typeof window[flag] === "function") return window[flag]();
  if (!src || window[flag]) return;
  window[flag] = "loading"; // its entry replaces this with its init function
  if (css && !document.querySelector('link[href="' + css + '"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = css;
    document.head.appendChild(link);
  }
  const script = document.createElement("script");
  script.src = src;
  script.async = true;
  document.head.appendChild(script);
}

if (!window.__sparefitEmbed) {
  window.__sparefitEmbed = true;
  boot(() => {
    each("[data-sp-embed]", "spEmbed", (el) => {
      initMySelection();
      clearSkuQuery();
      // Features without a block on this page: run their bundle (load it, or run it again).
      if (markTableCode(el))
        need(
          "__sparefitProduct",
          el.getAttribute("data-product-src"),
          el.getAttribute("data-product-css"),
        );
      if (document.querySelector("[data-sp-search]")) {
        need(
          "__sparefitSearch",
          el.getAttribute("data-search-src"),
          el.getAttribute("data-search-css"),
        );
      }
    });
  });
}
