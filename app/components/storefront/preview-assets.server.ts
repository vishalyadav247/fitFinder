// The theme's built scripts and stylesheets for the Storefront previews, read on the server and
// sent with the page's loader data (each file once; preview-doc.ts combines them per preview).
// The browser must not import them itself: in development the Shopify CLI proxy owns every
// /extensions/* URL (theme extension dev server), so a client import of
// extensions/fitfinder-theme/assets/* 404s and the whole page fails to hydrate.
import embedCss from "../../../extensions/fitfinder-theme/assets/ff-embed.css?raw";
import searchCss from "../../../extensions/fitfinder-theme/assets/ff-search.css?raw";
import productCss from "../../../extensions/fitfinder-theme/assets/ff-product.css?raw";
import searchJs from "../../../extensions/fitfinder-theme/assets/ff-search.js?raw";
import productJs from "../../../extensions/fitfinder-theme/assets/ff-product.js?raw";
import embedJs from "../../../extensions/fitfinder-theme/assets/ff-embed.js?raw";
import type { PreviewAssets } from "./preview-doc";

export const PREVIEW_ASSETS: PreviewAssets = {
  embedCss,
  searchCss,
  productCss,
  searchJs,
  productJs,
  embedJs,
};
