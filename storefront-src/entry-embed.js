// ff-embed.js (app embed, every page): My Selection, the [fitfinder-table] code in theme tabs
// (filled by ff-product.js),
// the save prompt on the theme's search page after a FitFinder search, and the search bundle
// for FitFinder's own results page (which has no block to load it).
import { askToSave, boot, each, getStore, onResultsPage } from "./core.js";
import { initMySelection } from "./my-selection.js";
import { markTableCode } from "./product.js";

const ASKED = "fitfinder:asked";

/** Theme search page opened by "Show {products}": ask once to save the selection. */
function askOnSearchPage() {
  if (document.querySelector("[data-ff-results]") || !onResultsPage()) return;
  const picks = getStore().current;
  const key = JSON.stringify(picks);
  try {
    if (sessionStorage.getItem(ASKED) === key) return;
    sessionStorage.setItem(ASKED, key);
  } catch {
    return;
  }
  const main = document.querySelector("main, #MainContent, [role=main]");
  if (!main) return;
  const box = document.createElement("div");
  box.className = "ff-ask-wrap page-width";
  main.prepend(box);
  askToSave(box, picks);
  if (!box.firstChild) box.remove();
}

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

if (!window.__fitfinderEmbed) {
  window.__fitfinderEmbed = true;
  boot(() => {
    each("[data-ff-embed]", "ffEmbed", (el) => {
      initMySelection();
      askOnSearchPage();
      // Features without a block on this page: run their bundle (load it, or run it again).
      if (markTableCode(el)) need(
          "__fitfinderProduct",
          el.getAttribute("data-product-src"),
          el.getAttribute("data-product-css"),
        );
      if (document.querySelector("[data-ff-search]")) {
        need(
          "__fitfinderSearch",
          el.getAttribute("data-search-src"),
          el.getAttribute("data-search-css"),
        );
      }
    });
  });
}
