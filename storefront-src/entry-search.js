// sp-search.js: the search section, and the widget on SpareFit's results page.
import { boot, each } from "./core.js";
import { initResults, initSearch } from "./search.js";

if (typeof window.__sparefitSearch !== "function") {
  // The init function, so the app embed can run it again for spots it adds later.
  window.__sparefitSearch = boot(() => {
    each("[data-sp-results]", "spResults", initResults);
    each("[data-sp-search]", "spSearch", initSearch);
  });
}
