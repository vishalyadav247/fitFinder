// ff-product.js: the fits badge and fitment table blocks, and tables from the shortcode
// ([fitfinder-table], marked by the app embed, which loads this bundle when there's no block).
import { boot, each } from "./core.js";
import { initBadge, initTable } from "./product.js";

if (typeof window.__fitfinderProduct !== "function") {
  // The init function, so the app embed can run it again for spots it adds later.
  window.__fitfinderProduct = boot(() => {
    each("[data-ff-badge]", "ffBadge", initBadge);
    // data-ff-tabs: a [fitfinder-table] code the app embed found in the theme's own tabs.
    each("[data-ff-table]", "ffTable", (el) => initTable(el, el.hasAttribute("data-ff-tabs")));
  });
}
