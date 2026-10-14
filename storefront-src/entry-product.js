// sp-product.js: the fits badge and fitment table blocks, and tables from the shortcode
// ([sparefit-table], marked by the app embed, which loads this bundle when there's no block).
import { boot, each } from "./core.js";
import { initBadge, initTable } from "./product.js";

if (typeof window.__sparefitProduct !== "function") {
  // The init function, so the app embed can run it again for spots it adds later.
  window.__sparefitProduct = boot(() => {
    each("[data-sp-badge]", "spBadge", initBadge);
    // data-sp-tabs: a [sparefit-table] code the app embed found in the theme's own tabs.
    each("[data-sp-table]", "spTable", (el) => initTable(el, el.hasAttribute("data-sp-tabs")));
  });
}
