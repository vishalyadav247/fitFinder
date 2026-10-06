// ff-search.js: the search section, and the widget + save prompt on the results page.
import { boot, each } from "./core.js";
import { initResults, initSearch } from "./search.js";

if (typeof window.__fitfinderSearch !== "function") {
  // The init function, so the app embed can run it again for spots it adds later.
  window.__fitfinderSearch = boot(() => {
    each("[data-ff-results]", "ffResults", initResults);
    each("[data-ff-search]", "ffSearch", initSearch);
  });
}
