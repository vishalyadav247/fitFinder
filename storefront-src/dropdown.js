// Search widget dropdown for mouse and trackpad screens: macOS draws a native <select>'s list over
// the field, so a button shows the value and opens its own list right under it (above only when
// there's no room below). The <select> stays, hidden, as the state: its options, value, disabled
// and change events drive the widget as before. Touch screens keep the native picker.
// The list lives in <body> with position: fixed, so a theme section's overflow or stacking can't
// clip or cover it; it follows the field while the page scrolls.
import { esc } from "./core.js";

let count = 0;

/** True where the custom list is used (a fine pointer that can hover). */
export const usesList = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/** Wraps a <select>; returns the button (the element to focus instead of the select). */
export function enhance(sel) {
  const id = "sp-dd-" + ++count;
  // A <label> around the button would click it again for every click inside: use a <div>.
  const label = sel.closest("label");
  const name = ((label && label.firstElementChild?.textContent) || "").trim();
  if (label) {
    const div = document.createElement("div");
    div.className = label.className;
    div.append(...label.childNodes);
    label.replaceWith(div);
  }
  const wrap = document.createElement("div");
  wrap.className = "sp-dd";
  sel.parentNode.insertBefore(wrap, sel);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sp-dd__btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", id);
  wrap.append(btn, sel);
  sel.className = "sp-dd__native";
  sel.tabIndex = -1;
  sel.setAttribute("aria-hidden", "true");
  const list = document.createElement("ul");
  list.className = "sp-dd__list";
  list.id = id;
  list.setAttribute("role", "listbox");
  if (name) list.setAttribute("aria-label", name);
  list.hidden = true;
  document.body.append(list);

  let active = -1;
  let typed = "";
  let typedAt = 0;

  const sync = () => {
    if (!btn.isConnected) return close();
    const o = sel.options[sel.selectedIndex];
    btn.textContent = o ? o.text : "";
    btn.classList.toggle("is-empty", !sel.value);
    btn.setAttribute("aria-label", (name ? name + ": " : "") + btn.textContent);
    btn.disabled = sel.disabled;
    if (sel.disabled) close();
    else if (!list.hidden) render();
  };

  const render = () => {
    list.innerHTML = [...sel.options]
      .map(
        (o, i) =>
          '<li role="option" id="' +
          id +
          "-" +
          i +
          '" data-i="' +
          i +
          '" aria-selected="' +
          (i === sel.selectedIndex) +
          '"' +
          (o.value ? "" : ' class="is-ph"') +
          ">" +
          esc(o.text) +
          "</li>",
      )
      .join("");
    mark(active);
  };

  const mark = (i) => {
    const items = list.children;
    if (!items.length) return;
    active = Math.max(0, Math.min(i, items.length - 1));
    for (const li of items) li.classList.remove("is-active");
    const li = items[active];
    li.classList.add("is-active");
    btn.setAttribute("aria-activedescendant", li.id);
    // Keep the active option in view inside the list only (never scroll the page).
    if (li.offsetTop < list.scrollTop) list.scrollTop = li.offsetTop;
    else if (
      li.offsetTop + li.offsetHeight >
      list.scrollTop + list.clientHeight
    )
      list.scrollTop = li.offsetTop + li.offsetHeight - list.clientHeight;
  };

  // Under the field (above only when it doesn't fit below and does above), as wide as the field.
  const place = () => {
    const r = btn.getBoundingClientRect();
    if (!r.width) return close();
    const h = list.offsetHeight + 4;
    const up = window.innerHeight - r.bottom < h && r.top > h;
    list.style.left = r.left + "px";
    list.style.width = r.width + "px";
    list.style.top = (up ? r.top - h : r.bottom + 4) + "px";
    list.style.borderRadius =
      Math.min(parseFloat(getComputedStyle(btn).borderTopLeftRadius) || 0, 10) +
      "px";
  };

  const onOutside = (e) => {
    if (e.target !== btn && !list.contains(e.target)) close();
  };

  const open = () => {
    if (sel.disabled || !list.hidden) return;
    active = Math.max(0, sel.selectedIndex);
    list.hidden = false;
    render();
    place();
    btn.setAttribute("aria-expanded", "true");
    document.addEventListener("mousedown", onOutside, true);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
  };

  function close() {
    if (list.hidden) return;
    list.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    btn.removeAttribute("aria-activedescendant");
    document.removeEventListener("mousedown", onOutside, true);
    window.removeEventListener("scroll", place, true);
    window.removeEventListener("resize", place);
  }

  const pick = (i) => {
    close();
    btn.focus();
    if (i === sel.selectedIndex) return;
    sel.selectedIndex = i;
    sync();
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  };

  btn.addEventListener("click", () => (list.hidden ? open() : close()));
  // Keep focus on the button while clicking an option.
  list.addEventListener("mousedown", (e) => e.preventDefault());
  list.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (li) pick(Number(li.getAttribute("data-i")));
  });
  list.addEventListener("mousemove", (e) => {
    const li = e.target.closest("li");
    if (li) mark(Number(li.getAttribute("data-i")));
  });
  btn.addEventListener("blur", close);
  // Space clicks a button when it is released: the list handles Space itself.
  btn.addEventListener("keyup", (e) => {
    if (e.key === " ") e.preventDefault();
  });
  btn.addEventListener("keydown", (e) => {
    const k = e.key;
    if (list.hidden) {
      if (k === "ArrowDown" || k === "ArrowUp" || k === " " || k === "Enter") {
        e.preventDefault();
        open();
      }
      return;
    }
    const last = sel.options.length - 1;
    const moves = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      Home: 0,
      End: last,
      PageDown: active + 8,
      PageUp: active - 8,
    };
    if (k in moves) {
      e.preventDefault();
      mark(moves[k]);
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      pick(active);
    } else if (k === "Escape") {
      e.preventDefault();
      close();
    } else if (k.length === 1) {
      // Type to jump: the next option starting with what was typed in the last second.
      const now = Date.now();
      typed = (now - typedAt < 1000 ? typed : "") + k.toLowerCase();
      typedAt = now;
      const texts = [...sel.options].map((o) => o.text.toLowerCase());
      const start = typed.length > 1 ? active : active + 1;
      for (let n = 0; n <= last; n++) {
        const i = (start + n) % (last + 1);
        if (texts[i].startsWith(typed)) {
          mark(i);
          break;
        }
      }
    }
  });

  // The widget changes options, the chosen one and disabled on the <select>: mirror them.
  new MutationObserver(sync).observe(sel, {
    childList: true,
    attributes: true,
    subtree: true,
  });
  sync();
  return btn;
}
