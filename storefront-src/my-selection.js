// My Selection, the floating saved-selections button of the app embed (specs/storefront.md ›
// My Selection tab). Closed: a fixed-size tab with icon, current selection and count; hover: a
// hint card; click: a panel that slides in from the same edge. Bundle: ff-embed.js.
import {
  cfg,
  CHANGE,
  esc,
  fill,
  getStore,
  keyOf,
  label,
  parts,
  removeSaved,
  onResultsPage,
  openResults,
  setCurrent,
  svg,
} from "./core.js";

const ICONS = {
  star: '<path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/>',
  heart:
    '<path d="M10 16.5S3 12.4 3 7.6A3.6 3.6 0 0110 5.9a3.6 3.6 0 017 1.7c0 4.8-7 8.9-7 8.9z"/>',
  bookmark: '<path d="M5.5 3h9v14l-4.5-3.2L5.5 17z"/>',
  clock: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 2"/>',
  car: '<path d="M3 13v-2.5L5 6h10l2 4.5V13z"/><circle cx="6.5" cy="13.5" r="1.5"/><circle cx="13.5" cy="13.5" r="1.5"/>',
  phone:
    '<rect x="6" y="2.5" width="8" height="15" rx="2"/><path d="M9 15h2"/>',
  beauty:
    '<rect x="7" y="8" width="6" height="9.5" rx="1.5"/><path d="M8 8V5.5l4-3V8"/>',
  spark:
    '<path d="M10 2v4M10 14v4M2 10h4M14 10h4M4.5 4.5l2.5 2.5M13 13l2.5 2.5M4.5 15.5 7 13M13 7l2.5-2.5"/>',
};
const TRASH =
  '<path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6M8.5 9v5M11.5 9v5"/>';
const ARROWS = {
  "left-middle": '<path d="M12 5l-5 5 5 5"/>',
  "right-middle": '<path d="M8 5l5 5-5 5"/>',
  bottom: '<path d="M6 8l4 4 4-4"/>',
};

export function iconHtml(s) {
  if (s.savedIcon === "custom") {
    return s.savedIconUrl
      ? '<img class="ff-ms__icon" src="' +
          esc(s.savedIconUrl) +
          '" alt="" width="24" height="24">'
      : "";
  }
  return ICONS[s.savedIcon] ? svg(ICONS[s.savedIcon], 24, 1.9) : "";
}

export function initMySelection() {
  const s = cfg.s;
  if (!s.garage || document.querySelector(".ff-ms")) return;
  const pos = s.savedPos;
  const box = document.createElement("div");
  box.className =
    "ff-ms ff-ms--" + pos + (pos.endsWith("-middle") ? " ff-ms--side" : "");
  // Hidden until ff-embed.css (loaded without blocking the page) arrives and shows it.
  box.style.visibility = "hidden";
  box.style.setProperty("--ff-ms-bg", s.savedBg);
  box.style.setProperty("--ff-ms-fg", s.savedText);
  document.body.appendChild(box);
  const icon = iconHtml(s);
  const close = svg(ARROWS[pos] || ARROWS.bottom, 18, 2.2);

  const render = () => {
    const { current: cur, saved } = getStore();
    const curKey = cur ? keyOf(cur) : null;
    const current = cur ? label(cur) : s.garageName;
    const n = saved.length;
    box.innerHTML =
      '<button type="button" class="ff-ms__tab" title="' +
      esc(current) +
      '" aria-expanded="false" aria-label="' +
      esc(s.garageName + ": " + current) +
      '">' +
      icon +
      "<span>" +
      esc(current) +
      "</span>" +
      (s.savedCount && n ? '<em class="ff-ms__count">' + n + "</em>" : "") +
      "</button>" +
      '<div class="ff-ms__hint" aria-hidden="true"><b>' +
      esc(cur ? s.hintTitle : s.garageName) +
      "</b><span>" +
      esc(cur ? current : n ? fill(s.hintSub, n) : s.hintEmpty) +
      "</span><small>" +
      esc(cur ? fill(s.hintSub, n) : n ? "" : s.hintEmptySub) +
      "</small></div>" +
      '<div class="ff-ms__panel" role="dialog" aria-label="' +
      esc(s.garageName) +
      '"><button type="button" class="ff-ms__handle" aria-label="Close">' +
      close +
      '</button><p class="ff-ms__title">' +
      esc(s.garageName) +
      "</p>" +
      saved
        .map((p, i) => {
          const on = keyOf(p) === curKey;
          const pp = parts(p);
          return (
            '<div class="ff-ms__item' +
            (on ? " is-on" : "") +
            '">' +
            (on
              ? '<span class="ff-ms__pill">' + esc(s.msSelected) + "</span>"
              : "") +
            '<button type="button" class="ff-ms__pick" data-i="' +
            i +
            '"><b>' +
            esc(pp.top) +
            "</b>" +
            (pp.sub ? "<small>" + esc(pp.sub) + "</small>" : "") +
            '</button><button type="button" class="ff-ms__del" data-del="' +
            i +
            '" aria-label="Remove ' +
            esc(label(p)) +
            '">' +
            svg(TRASH, 18, 1.7) +
            "</button></div>"
          );
        })
        .join("") +
      // The button takes the text colour as background; its label is always white.
      '<button type="button" class="ff-ms__add" style="background:' +
      s.savedText +
      '">' +
      esc(s.msAdd) +
      "</button></div>";
  };

  const open = (yes) => {
    box.classList.toggle("is-open", yes);
    box.querySelector(".ff-ms__tab").setAttribute("aria-expanded", String(yes));
    if (yes) box.querySelector(".ff-ms__handle").focus({ preventScroll: true });
  };

  box.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest(".ff-ms__tab")) return open(true);
    if (t.closest(".ff-ms__handle")) return open(false);
    const del = t.closest("[data-del]");
    if (del) return removeSaved(Number(del.getAttribute("data-del")));
    const pick = t.closest("[data-i]");
    if (pick) {
      const p = getStore().saved[Number(pick.getAttribute("data-i"))];
      open(false);
      if (!p) return;
      // On a results page, switching shows the results of the chosen selection.
      if (onResultsPage()) openResults(p);
      else setCurrent(p);
      return;
    }
    if (t.closest(".ff-ms__add")) {
      open(false);
      const widget = [...document.querySelectorAll("[data-ff-search]")].find(
        (w) => w.ffFocus,
      );
      if (widget) widget.ffFocus();
      else window.location.href = cfg.proxy + "/results";
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && box.classList.contains("is-open")) open(false);
  });
  // composedPath: a click that re-rendered the panel (remove) still counts as inside.
  document.addEventListener("click", (e) => {
    if (box.classList.contains("is-open") && !e.composedPath().includes(box))
      open(false);
  });
  document.addEventListener(CHANGE, () => {
    const wasOpen = box.classList.contains("is-open");
    render();
    if (wasOpen) open(true);
  });
  render();
}
