// The Results page tab's live preview: SpareFit's results page as shoppers see it, built from the
// same markup and stylesheet as the real page (results-page.ts › resultsBody, STYLE) with the
// draft settings, the store's products as static cards and the filters counted from their tags
// (facetsFor). Desktop renders at full page width and is scaled down to fit; filter clicks and
// the sort work inside the preview.
import { useEffect, useMemo, useRef, useState } from "react";
import type { StorefrontConfig } from "../../services/storefront/config";
import {
  cardParts,
  tagBadgeHtml,
  escapeLiquidText as esc,
  resultsBody,
  STYLE,
  type ResultsState,
} from "../../services/storefront/results-page";
import {
  defaultResultsPage,
  facetsFor,
  productsPerPage,
  type FilterPicks,
  type ResultsPageSettings,
} from "../../services/storefront/results-settings";

const DESKTOP_WIDTH = 1200;
const MOBILE_WIDTH = 375;

// Page look around the results (the theme's own font and colours aren't known here).
const PAGE_CSS = `<style>
html,body{margin:0;background:#fff;color:#1a1a1a;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.sp-results{width:auto!important;padding:16px 32px 32px}
.sp-card__p--ph{display:block;width:48px;height:10px;margin-top:4px;border-radius:4px;background:rgba(0,0,0,.12)}
a{cursor:pointer}
</style>`;
// The modal preview scrolls inside the frame: no scrollbar beside the page.
const BARE_CSS = `<style>html{scrollbar-width:none}html::-webkit-scrollbar{display:none}</style>`;

const RADIUS = { square: 2, rounded: 10, pill: 999 } as const;

/** Dropdown and search button looks, as the widget script writes them (storefront-src/search.js). */
const widgetLooks = (s: StorefrontConfig["s"]) =>
  [
    s.ddBg && `--sp-ddb:${s.ddBg}`,
    s.ddText && `--sp-ddt:${s.ddText}`,
    s.ddCorners && `--sp-ddr:${RADIUS[s.ddCorners]}px`,
    s.btnText && `--sp-bt:${s.btnText}`,
    s.btnCorners && `--sp-btr:${RADIUS[s.btnCorners]}px`,
    s.headColor && `--sp-ht:${s.headColor}`,
    s.labelColor && `--sp-lt:${s.labelColor}`,
    s.saveColor && `--sp-st:${s.saveColor}`,
    s.resetColor && `--sp-rc:${s.resetColor}`,
  ]
    .filter(Boolean)
    .map((v) => `;${v}`)
    .join("");

/**
 * The search widget as shoppers see it on a mouse or trackpad screen: the block's markup
 * (sparefit-search.liquid) with each dropdown as the script's own button (dropdown.js), filled with
 * the example selection. The preview runs no scripts, so it is drawn here.
 */
function widgetHtml(config: StorefrontConfig, picks: Record<string, string>) {
  const s = config.s;
  const r = RADIUS[s.corners] ?? 10;
  const fields = config.fields
    .map(
      (f) =>
        `<label class="sp-sfw__f"><span class="${s.labels ? "sp-sfw__l" : "sp-sr"}">${esc(f.label)}</span><span class="sp-dd"><button type="button" tabindex="-1" class="sp-dd__btn${picks[f.id] ? "" : " is-empty"}">${esc(picks[f.id] || f.placeholder)}</button></span></label>`,
    )
    .join("");
  const links =
    s.saveLink || s.reset
      ? `<div class="sp-sfw__links">${s.saveLink ? `<button type="button" class="sp-sfw__save"><i class="sp-sfw__star" aria-hidden="true"></i> <span>${esc(s.saveText)}</span></button>` : "<span></span>"}${s.reset ? `<button type="button" class="sp-sfw__reset">${esc(s.resetText)}</button>` : ""}</div>`
      : "";
  return `<div class="sp-search-wrap"><div class="sp-sfw sp-sfw--${s.layout === "card" ? "v" : "h"}" style="--sp-b:${s.btn};--sp-bg:${s.bg};--sp-t:${s.text};--sp-r:${Math.min(r, 14)}px;--sp-rb:${r}px${widgetLooks(s)}">${s.showHeading ? `<p class="sp-sfw__h">${esc(config.heading)}</p>` : ""}<div class="sp-sfw__row">${fields}<button type="button" class="sp-sfw__go">${esc(s.button)}</button></div>${links}</div></div>`;
}

export function ResultsPreview({
  config,
  settings,
  sample,
  label,
  picks,
  widgetCss,
  device,
  bare = false,
}: {
  config: StorefrontConfig;
  settings: ResultsPageSettings;
  sample: { title: string; tags: string[]; sku?: string }[];
  /** The example selection shown under the title. */
  label: string;
  /** The example selection by field id: fills the widget's dropdowns. */
  picks: Record<string, string>;
  /** The search widget's stylesheet (theme extension assets). */
  widgetCss: string;
  device: "desktop" | "mobile";
  /** No border, corners or spacing around the page (the preview modal). */
  bare?: boolean;
}) {
  const [state, setState] = useState<ResultsState>({
    filterPicks: {},
    sort: settings.sort,
    page: 1,
  });
  // A new default sort shows at once.
  useEffect(() => {
    setState((s) => ({ ...s, sort: settings.sort, page: 1 }));
  }, [settings.sort]);
  // Picks of filters that were removed are dropped.
  const filterPicks: FilterPicks = Object.fromEntries(
    Object.entries(state.filterPicks).filter(([id]) =>
      settings.filters.some((f) => f.id === id),
    ),
  );

  const doc = useMemo(() => {
    const perPage = productsPerPage(settings);
    const matching = sample.filter((p) =>
      settings.filters.every((f) => {
        const want = filterPicks[f.id];
        if (!want?.length) return true;
        return p.tags.some((t) => want.includes(t.toLowerCase()));
      }),
    );
    const sorted =
      state.sort === "match"
        ? matching
        : [...matching].sort(
            (a, b) =>
              a.title.localeCompare(b.title) *
              (state.sort === "title-desc" ? -1 : 1),
          );
    const pageCount = Math.max(1, Math.ceil(sorted.length / perPage));
    const page = Math.min(state.page, pageCount);
    const shown = sorted.slice((page - 1) * perPage, page * perPage);
    const view = {
      config,
      picks: {},
      label,
      complete: true,
      results: {
        products: shown.map((_, i) => ({
          handle: String(i),
          universal: false,
        })),
        total: sorted.length,
        page,
        pageCount,
        facets: facetsFor(sample, settings.filters, filterPicks),
      },
      settings,
      state: { ...state, filterPicks, page },
      // Links carry the state they lead to; clicks are handled below.
      href: (next: ResultsState) =>
        `#${encodeURIComponent(JSON.stringify(next))}`,
      pickQuery: [],
    };
    const card = (p: { handle: string }) => {
      const product = shown[Number(p.handle)];
      const parts = cardParts(
        { ...defaultResultsPage(), ...settings },
        { [p.handle]: product?.tags ?? [] },
      );
      // Tag badges only: Sold out and Sale need live store data.
      const badges = parts
        .tagBadges(p.handle)
        .map((b) => tagBadgeHtml(b, esc))
        .join("");
      return `<li class="sp-card"><a><span class="sp-card__media"><span class="sp-card__img sp-card__img--none"></span><span class="sp-card__badges">${badges}</span></span>${parts.vendor ? `<span class="sp-card__v sp-card__p--ph"></span>` : ""}<span class="sp-card__t">${esc(product?.title ?? "")}</span>${parts.sku && product?.sku ? `<span class="sp-card__sku">SKU ${esc(product.sku)}</span>` : ""}${parts.fit ? `<span class="sp-card__fit">&#10003; ${esc(config.s.fitsText)}</span>` : ""}${parts.price ? `<span class="sp-card__p sp-card__p--ph"></span>` : ""}</a>${parts.cart ? `<span class="sp-card__btn">${esc(parts.cartText)}</span>` : ""}</li>`;
    };
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${widgetCss}</style>${STYLE}${PAGE_CSS}${bare ? BARE_CSS : ""}</head><body>${resultsBody(view, card, false, widgetHtml(config, picks))}</body></html>`;
    // filterPicks is derived from state and settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, settings, sample, label, state, picks, widgetCss, bare]);

  // ---------------------------------------------------------------- size
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const [boxHeight, setBoxHeight] = useState(0);
  const [height, setHeight] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      setBoxWidth(e.contentRect.width);
      setBoxHeight(e.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const width = device === "mobile" ? MOBILE_WIDTH : DESKTOP_WIDTH;
  const scale = boxWidth ? Math.min(1, boxWidth / width) : 0;
  // Bare (the modal): the box has a fixed height and the page scrolls inside the frame, so the
  // modal itself never scrolls (its scrollbar would sit beside the page).
  const frameHeight = bare && scale && boxHeight ? boxHeight / scale : height;

  // After each load: measure the page, and turn filter links and the sort into state changes.
  const onLoad = () => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    const measure = () => setHeight(d.documentElement.scrollHeight);
    measure();
    setTimeout(measure, 50);
    d.addEventListener("click", (e) => {
      const a = (e.target as Element).closest?.("a");
      if (!a) return;
      e.preventDefault();
      const target = a.getAttribute("href") ?? "";
      if (!target.startsWith("#") || target.length < 2) return;
      try {
        setState(JSON.parse(decodeURIComponent(target.slice(1))));
      } catch {
        // not a state link
      }
    });
    d.querySelector("select[name=sort]")?.addEventListener("change", (e) => {
      const sort = (e.target as HTMLSelectElement)
        .value as ResultsState["sort"];
      setState((s) => ({ ...s, sort, page: 1 }));
    });
    d.addEventListener("submit", (e) => e.preventDefault());
    d.getElementById("sp-rp-ft")?.addEventListener("change", () =>
      setTimeout(measure, 0),
    );
  };

  return (
    <div ref={box} className={`sp-rp-pv${bare ? " is-bare" : ""}`}>
      <div
        className="sp-rp-pv__clip"
        style={{
          height: bare ? "100%" : scale ? height * scale : 0,
          width: scale ? width * scale : "100%",
        }}
      >
        {scale > 0 && (
          <iframe
            ref={frame}
            title="Results page preview"
            className="sp-rp-pv__frame"
            // No scripts run inside; the page here reads its links and form.
            sandbox="allow-same-origin"
            srcDoc={doc}
            onLoad={onLoad}
            style={{
              // Fixed page width: a host "iframe { max-width: 100% }" rule mustn't squeeze it.
              width,
              minWidth: width,
              maxWidth: "none",
              height: frameHeight,
              transform: `scale(${scale})`,
            }}
          />
        )}
      </div>
    </div>
  );
}
