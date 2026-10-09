// Product page: fits badge and fitment table (specs/storefront.md › Fits badge, Fitment table).
// Bundles: ff-product.js (the two blocks) and ff-embed.js (the [fitfinder-table] code in tabs).
import {
  api,
  cfg,
  CHANGE,
  collator,
  esc,
  fill,
  getStore,
  keyOf,
  label,
  query,
  openResults,
  resultsUrl,
  svg,
  YEAR,
} from "./core.js";

const DASH = String.fromCharCode(8212); // em dash: no value
const TO = " " + String.fromCharCode(8211) + " "; // en dash between years
const DOWN = '<path d="M6 8l4 4 4-4"/>';

const productParams = (el, picks) =>
  query(picks, {
    product: el.getAttribute("data-product"),
    collections: el.getAttribute("data-collections") || "",
  });

export function initBadge(el) {
  const s = cfg.s;
  const ask = '<div class="ff-fit ff-fit--ask">' + esc(s.askText) + "</div>";
  const render = () => {
    const picks = getStore().current;
    api("fits", productParams(el, picks || {})).then(
      (d) => {
        if (keyOf(getStore().current) !== keyOf(picks)) return;
        // Products FitFinder doesn't cover (no rows, not universal, e.g. gift cards): no badge.
        // Theme editor: keep it visible, so the merchant can see where it sits.
        if (!d.total && !d.universal) {
          el.innerHTML = el.hasAttribute("data-ff-editor") ? ask : "";
          return;
        }
        if (!picks) {
          el.innerHTML = ask;
          return;
        }
        const sel = s.badgeSel
          ? "<small>" + esc(label(picks)) + "</small>"
          : "";
        el.innerHTML =
          d.state === "fits"
            ? '<div class="ff-fit ff-fit--ok">&#10003; ' +
              esc(s.fitsText) +
              sel +
              "</div>"
            : d.state === "no-fit"
              ? '<div class="ff-fit ff-fit--no">&#10005; ' +
                esc(s.noFitText) +
                sel +
                (s.noFitLink
                  ? '<a class="ff-fit__link" href="' +
                    esc(resultsUrl(picks)) +
                    '">' +
                    esc(s.noFitLinkText) +
                    " &rarr;</a>"
                  : "") +
                "</div>"
              : ask;
      },
      () => {
        // keep what is shown
      },
    );
  };
  el.addEventListener("click", (e) => {
    const link = e.target.closest(".ff-fit__link");
    const picks = getStore().current;
    if (!link || !picks) return;
    e.preventDefault();
    openResults(picks);
  });
  document.addEventListener(CHANGE, render);
  render();
}

export function yearsText(y) {
  if (!y) return DASH;
  if (y[1] === y[0]) return String(y[0]);
  return y[0] + TO + (y[1] == null ? "now" : y[1]);
}

const cell = (f, row) =>
  f.type === "years" ? yearsText(row.y) : row.v[f.id] || DASH;

/** Table rows in the chosen order: search field order A–Z, or newest year first. */
export function sortRows(rows, by) {
  const yearField = cfg.fields.find((f) => f.type === "years");
  const newest = (r) => (r.y ? (r.y[1] == null ? YEAR : r.y[1]) : 0);
  const text = (r) => cfg.fields.map((f) => cell(f, r)).join("|");
  return [...rows].sort(
    by === "year" && yearField
      ? (a, b) => newest(b) - newest(a) || collator.compare(text(a), text(b))
      : (a, b) => collator.compare(text(a), text(b)),
  );
}

/** inTabs: inside the theme's own tab (code [fitfinder-table]); the theme owns title and toggle. */
export function initTable(el, inTabs) {
  const s = cfg.s;
  const cols = cfg.fields.filter((f) => !s.tableHide[f.id]);
  const wrap = (inner, opened = s.tableOpen) => {
    if (inTabs) return inner;
    if (s.tableStyle === "open") {
      return (
        '<div class="ff-ft-open"><b>' +
        esc(s.tableTitle) +
        "</b>" +
        inner +
        "</div>"
      );
    }
    return (
      '<details class="ff-acc"' +
      (opened ? " open" : "") +
      "><summary><span>" +
      esc(s.tableTitle) +
      '</span><i aria-hidden="true">' +
      svg(DOWN, 16, 2) +
      '</i></summary><div class="ff-acc__body">' +
      inner +
      "</div></details>"
    );
  };
  api("fits", productParams(el, {})).then(
    (d) => {
      if (!d.rows.length) {
        // Theme editor: a table that would be hidden shows like "Show a text instead", so the
        // merchant can see where it sits.
        const text =
          s.tableEmpty === "text" || el.hasAttribute("data-ff-editor");
        el.innerHTML = text
          ? wrap('<p class="ff-ft-empty">' + esc(s.tableEmptyText) + "</p>", true)
          : "";
        el.hidden = !text;
        return;
      }
      const rows = sortRows(d.rows, s.tableSort);
      const limit = s.tableRows === "all" ? Infinity : Number(s.tableRows);
      const table = (all) =>
        '<table class="ff-ft ff-ft--' +
        s.tableLook +
        '"><thead><tr>' +
        cols.map((f) => '<th scope="col">' + esc(f.label) + "</th>").join("") +
        "</tr></thead><tbody>" +
        (all ? rows : rows.slice(0, limit))
          .map(
            (row) =>
              "<tr>" +
              cols.map((f) => "<td>" + esc(cell(f, row)) + "</td>").join("") +
              "</tr>",
          )
          .join("") +
        "</tbody></table>" +
        (!all && rows.length > limit
          ? '<button type="button" class="ff-ft-more">' +
            esc(fill(s.showAllText, d.total)) +
            "</button>"
          : "");
      el.innerHTML = wrap(
        '<div class="ff-ft-scroll">' + table(false) + "</div>",
      );
      el.hidden = false;
      el.addEventListener("click", (e) => {
        if (e.target.closest(".ff-ft-more")) {
          el.querySelector(".ff-ft-scroll").innerHTML = table(true);
        }
      });
    },
    () => {
      el.hidden = true;
    },
  );
}

const CODE = "[fitfinder-table]";

/**
 * Product pages: replaces the shortcode [fitfinder-table] anywhere on the page with an empty table
 * spot (data-ff-table data-ff-tabs) that ff-product.js fills. Returns how many it found.
 */
export function markTableCode(embed) {
  const product = embed.getAttribute("data-product");
  if (!product) return 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentNode && n.parentNode.nodeName;
      return p === "SCRIPT" || p === "STYLE" || p === "TEXTAREA" || !n.nodeValue.includes(CODE)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  const found = [];
  while (walker.nextNode()) found.push(walker.currentNode);
  for (const node of found) {
    const rest = node.splitText(node.nodeValue.indexOf(CODE));
    rest.nodeValue = rest.nodeValue.slice(CODE.length);
    const div = document.createElement("div");
    div.className = "ff-table-wrap ff-table-wrap--tabs";
    div.setAttribute("data-ff-table", "");
    div.setAttribute("data-ff-tabs", "");
    div.setAttribute("data-product", product);
    div.setAttribute("data-collections", embed.getAttribute("data-collections") || "");
    rest.parentNode.insertBefore(div, rest);
  }
  return found.length;
}
