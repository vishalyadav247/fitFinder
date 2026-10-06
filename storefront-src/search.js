// Search widget and results page (specs/storefront.md › Search widget). Bundle: ff-search.js.
import {
  api,
  askToSave,
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

const RADIUS = { square: 2, rounded: 10, pill: 999 };

const pagePicks = (el) => {
  try {
    return clean(JSON.parse(el.getAttribute("data-ff-picks") || "{}"));
  } catch {
    return {};
  }
};

export function initSearch(el) {
  const s = cfg.s;
  const host = el.closest("[data-ff-results]");
  // On the results page the widget shows that page's selection; elsewhere the current one.
  const fixed = host ? pagePicks(host) : null;
  let picks = fixed ? { ...fixed } : clean(getStore().current);
  let run = 0;
  const r = RADIUS[s.corners] || 10;
  el.innerHTML =
    '<div class="ff-sfw ff-sfw--' +
    (s.layout === "card" ? "v" : "h") +
    '" style="--ff-b:' +
    s.btn +
    ";--ff-bg:" +
    s.bg +
    ";--ff-t:" +
    s.text +
    ";--ff-r:" +
    Math.min(r, 14) +
    "px;--ff-rb:" +
    r +
    'px">' +
    (s.showHeading ? '<p class="ff-sfw__h">' + esc(cfg.heading) + "</p>" : "") +
    '<div class="ff-sfw__row">' +
    cfg.fields
      .map(
        (f, i) =>
          '<label class="ff-sfw__f"><span class="' +
          (s.labels ? "ff-sfw__l" : "ff-sr") +
          '">' +
          esc(f.label) +
          '</span><select data-i="' +
          i +
          '" disabled><option value="">' +
          esc(f.placeholder) +
          "</option></select></label>",
      )
      .join("") +
    '<button type="button" class="ff-sfw__go" disabled>' +
    esc(s.button) +
    "</button></div>" +
    (s.saveLink || s.reset
      ? '<div class="ff-sfw__links">' +
        (s.saveLink
          ? '<button type="button" class="ff-sfw__save">&#9734; <span>' +
            esc(s.saveText) +
            "</span></button>"
          : "<span></span>") +
        (s.reset
          ? '<button type="button" class="ff-sfw__reset">' +
            esc(s.resetText) +
            "</button>"
          : "") +
        "</div>"
      : "") +
    "</div>";
  const selects = el.querySelectorAll("select");
  const go = el.querySelector(".ff-sfw__go");

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
      api("options", query(before(i), { field: f.id })).then(
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
          for (const later of [...selects].slice(i)) {
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
  const saveBtn = el.querySelector(".ff-sfw__save");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      if (!complete(picks)) {
        const empty = [...selects].find((x) => !x.disabled && !x.value);
        if (empty) empty.focus();
        return;
      }
      save({ ...picks });
      saveBtn.classList.add("is-saved");
      setTimeout(() => saveBtn.classList.remove("is-saved"), 1500);
    });
  }
  const resetBtn = el.querySelector(".ff-sfw__reset");
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
  el.ffFocus = () => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const first = [...selects].find((x) => !x.disabled);
    if (first) first.focus({ preventScroll: true });
  };
  refresh(0);
}

/** FitFinder's results page: its selection becomes the current one; offer to save it. */
export function initResults(el) {
  const picks = pagePicks(el);
  if (!complete(picks)) return;
  if (keyOf(clean(getStore().current)) !== keyOf(picks)) setCurrent(picks);
  const slot = el.querySelector("[data-ff-ask-save]");
  if (slot) askToSave(slot, picks);
}
