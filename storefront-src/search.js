// Search widget and results page (specs/storefront.md › Search widget). Bundle: sp-search.js.
import {
  api,
  cfg,
  CHANGE,
  clean,
  complete,
  esc,
  getStore,
  keyOf,
  openResults,
  query,
  save,
  setCurrent,
} from "./core.js";
import { enhance, usesList } from "./dropdown.js";

const RADIUS = { square: 2, rounded: 10, pill: 999 };
// The widget's looks as CSS variables (--sp-{name}: setting; a bare name is both). Only set
// ones are written: settings published before one existed keep the stylesheet's default.
// Colours are #RRGGBB, checked when saved.
const VARS =
  "b:btn,bg,t:text,ddb:ddBg,ddt:ddText,bt:btnText,ht:headColor,lt:labelColor,st:saveColor,rc:resetColor,r,rb,ddr,btr";
const px = (c) => RADIUS[c] && RADIUS[c] + "px";
const looks = (s, r) => {
  const v = {
    ...s,
    r: Math.min(r, 14) + "px",
    rb: r + "px",
    ddr: px(s.ddCorners),
    btr: px(s.btnCorners),
  };
  return VARS.split(",")
    .map((p) => {
      const [k, n = k] = p.split(":");
      return v[n] ? "--sp-" + k + ":" + v[n] + ";" : "";
    })
    .join("");
};

const pagePicks = (el) => {
  try {
    return clean(JSON.parse(el.getAttribute("data-sp-picks") || "{}"));
  } catch {
    return {};
  }
};

/**
 * The first dropdown's values the search block printed (app metafield sparefit.first), or null:
 * none printed, no list (too large, not read), or published for a field that is no longer
 * first (the order changed and the new list isn't published yet). Null → ask the proxy.
 */
const firstList = (el) => {
  try {
    const node = el.querySelector("script[data-sp-first]");
    const list = node && JSON.parse(node.textContent);
    return list && list.f === cfg.fields[0].id && Array.isArray(list.v)
      ? list.v
      : null;
  } catch {
    return null;
  }
};

export function initSearch(el) {
  const s = cfg.s;
  // Read before the widget replaces the block's markup.
  const first = firstList(el);
  // The banner image from the theme editor (search block settings): kept at the card's top.
  const banner = el.querySelector(".sp-sfw__banner");
  const host = el.closest("[data-sp-results]");
  // On the results page the widget shows that page's selection; elsewhere the current one.
  const fixed = host ? pagePicks(host) : null;
  let picks = fixed ? { ...fixed } : clean(getStore().current);
  let run = 0;
  const r = RADIUS[s.corners] || 10;
  el.innerHTML =
    '<div class="sp-sfw sp-sfw--' +
    (s.layout === "card" ? "v" : "h") +
    '" style="' +
    looks(s, r) +
    '">' +
    (s.showHeading ? '<p class="sp-sfw__h">' + esc(cfg.heading) + "</p>" : "") +
    '<div class="sp-sfw__row">' +
    cfg.fields
      .map(
        (f, i) =>
          '<label class="sp-sfw__f"><span class="' +
          (s.labels ? "sp-sfw__l" : "sp-sr") +
          '">' +
          esc(f.label) +
          '</span><select data-i="' +
          i +
          '" disabled><option value="">' +
          esc(f.placeholder) +
          "</option></select></label>",
      )
      .join("") +
    '<button type="button" class="sp-sfw__go" disabled>' +
    esc(s.button) +
    "</button></div>" +
    (s.saveLink || s.reset
      ? '<div class="sp-sfw__links">' +
        (s.saveLink
          ? '<button type="button" class="sp-sfw__save"><i class="sp-sfw__star" aria-hidden="true"></i> <span>' +
            esc(s.saveText) +
            "</span></button>"
          : "") +
        (s.reset
          ? '<button type="button" class="sp-sfw__reset">' +
            esc(s.resetText) +
            "</button>"
          : "") +
        "</div>"
      : "") +
    "</div>";
  if (banner) el.firstElementChild.prepend(banner);
  const selects = [...el.querySelectorAll("select")];
  // Mouse and trackpad screens get a list that opens under the field (dropdown.js).
  const buttons = usesList() ? selects.map(enhance) : [];
  const focusField = (sel, opts) =>
    (buttons[selects.indexOf(sel)] || sel).focus(opts);
  const go = el.querySelector(".sp-sfw__go");

  const enabledAt = (i) =>
    cfg.fields.slice(0, i).every((f) => !f.required || picks[f.id]);
  const before = (i) => {
    const p = {};
    for (const f of cfg.fields.slice(0, i))
      if (picks[f.id]) p[f.id] = picks[f.id];
    return p;
  };

  // Loads the dropdowns from field `from` on, one after the other (each depends on the picks
  // before it). A newer refresh cancels an older one.
  function refresh(from) {
    const mine = ++run;
    go.disabled = !complete(picks);
    const step = (i) => {
      if (mine !== run) return;
      if (i >= cfg.fields.length) {
        go.disabled = !complete(picks);
        return;
      }
      const f = cfg.fields[i];
      const sel = selects[i];
      sel.length = 1;
      if (!enabledAt(i)) {
        delete picks[f.id];
        sel.disabled = true;
        step(i + 1);
        return;
      }
      // The first dropdown's values come with the page (firstList), so a page load asks the
      // app nothing; the later ones depend on the picks and are asked for.
      const load =
        i === 0 && first
          ? Promise.resolve({ options: first })
          : api("options", query(before(i), { field: f.id }));
      load.then(
        (data) => {
          if (mine !== run) return;
          const opts = data.options || [];
          if (!opts.includes(picks[f.id])) delete picks[f.id];
          sel.insertAdjacentHTML(
            "beforeend",
            opts
              .map(
                (o) =>
                  "<option" +
                  (picks[f.id] === o ? " selected" : "") +
                  ">" +
                  esc(o) +
                  "</option>",
              )
              .join(""),
          );
          sel.disabled = !opts.length;
          step(i + 1);
        },
        () => {
          if (mine !== run) return;
          // Request failed: this and the later dropdowns stay empty and disabled.
          for (const later of selects.slice(i)) {
            later.length = 1;
            later.disabled = true;
          }
          go.disabled = true;
        },
      );
    };
    step(from);
  }

  el.addEventListener("change", (e) => {
    const i = Number(e.target.getAttribute("data-i"));
    if (Number.isNaN(i)) return;
    const id = cfg.fields[i].id;
    if (e.target.value) picks[id] = e.target.value;
    else delete picks[id];
    for (const f of cfg.fields.slice(i + 1)) delete picks[f.id];
    refresh(i + 1);
  });
  go.addEventListener("click", () => {
    if (!complete(picks)) return;
    go.disabled = true;
    openResults({ ...picks });
  });
  const saveBtn = el.querySelector(".sp-sfw__save");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      if (!complete(picks)) {
        const empty = selects.find((x) => !x.disabled && !x.value);
        if (empty) focusField(empty);
        return;
      }
      save({ ...picks });
      saveBtn.classList.add("is-saved");
      setTimeout(() => saveBtn.classList.remove("is-saved"), 1500);
    });
  }
  const resetBtn = el.querySelector(".sp-sfw__reset");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      picks = {};
      if (!fixed) setCurrent(null);
      refresh(0);
    });
  }
  // Another selection chosen in My Selection: show it (the results page keeps its own).
  document.addEventListener(CHANGE, () => {
    const current = clean(getStore().current);
    if (fixed || keyOf(current) === keyOf(picks)) return;
    picks = current;
    refresh(0);
  });
  // My Selection's "Add a {noun}" brings the shopper here.
  el.spFocus = () => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const first = selects.find((x) => !x.disabled);
    if (first) focusField(first, { preventScroll: true });
  };
  refresh(0);
}

/** SpareFit's results page: its selection becomes the current one. */
export function initResults(el) {
  const picks = pagePicks(el);
  if (!complete(picks)) return;
  if (keyOf(clean(getStore().current)) !== keyOf(picks)) setCurrent(picks);
}
