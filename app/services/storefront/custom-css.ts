// Custom CSS (specs/settings.md › Custom CSS): the merchant's own CSS for SpareFit's storefront
// parts, scoped so it can only style them. Every selector is rewritten to match inside (or on)
// one of SpareFit's root elements; @import and the other global at-rules are dropped, and
// nothing in the output can close the <style> tag the theme prints it in. Pure.

export const CUSTOM_CSS_MAX = 5000;

/**
 * SpareFit's root elements on the storefront: search widget (and SpareFit's results page), the
 * widget's dropdown lists (they sit in <body>), Fits badge, fitment table and My Selection.
 */
export const CSS_SCOPES = [
  ".sp-search-wrap",
  ".sp-results",
  ".sp-dd__list",
  ".sp-badge-wrap",
  ".sp-table-wrap",
  ".sp-ms",
] as const;

const ROOT = `:is(${CSS_SCOPES.join(",")})`;

/** At-rules whose rules are scoped like top-level ones; every other at-rule is dropped. */
const GROUPS = new Set(["media", "supports", "container"]);

export interface ScopedCss {
  /** The CSS to publish ("" when nothing is left). */
  css: string;
  /** What was left out, for the merchant: "@import", "nested rules" … (unique, in order). */
  dropped: string[];
}

/** Scopes the merchant's CSS to SpareFit's storefront elements. */
export function scopeCss(input: string): ScopedCss {
  const dropped: string[] = [];
  const drop = (what: string) => {
    if (!dropped.includes(what)) dropped.push(what);
  };
  const source = stripComments(input.slice(0, CUSTOM_CSS_MAX));
  const css = block(source, drop).join("\n");
  // "<" has no use outside strings; escaped, nothing can close the <style> tag.
  return { css: css.replace(/</g, "\\3c "), dropped };
}

/** At most this much CSS is published, whatever scoping adds. */
export const SCOPED_CSS_MAX = 20_000;

/** Rules of a stylesheet or of an @media / @supports / @container body. */
function block(src: string, drop: (what: string) => void): string[] {
  const out: string[] = [];
  let size = 0;
  let i = 0;
  while (i < src.length) {
    while (i < src.length && /[\s;]/.test(src[i])) i++;
    if (i >= src.length) break;
    const open = scanTo(src, i, "{;");
    if (open < 0) {
      drop("an unfinished rule");
      break;
    }
    const prelude = src.slice(i, open).trim();
    if (src[open] === ";") {
      // A statement at-rule (@import, @charset …) or stray text.
      drop(prelude.startsWith("@") ? atName(prelude) : "text outside a rule");
      i = open + 1;
      continue;
    }
    const close = matching(src, open);
    if (close < 0) {
      drop("an unfinished rule");
      break;
    }
    const body = src.slice(open + 1, close);
    i = close + 1;
    let rules: string[];
    if (prelude.startsWith("@")) {
      const name = atName(prelude);
      if (!GROUPS.has(name.slice(1).toLowerCase())) {
        drop(name);
        continue;
      }
      if (scanTo(prelude, 0, "{};") !== -1) {
        drop("an unfinished rule");
        continue;
      }
      const inner = block(body, drop);
      rules = inner.length ? [`${prelude}{\n${inner.join("\n")}\n}`] : [];
    } else {
      // The body is printed as written, so it must hold no rule end the browser could see.
      if (scanTo(body, 0, "{}") !== -1) {
        drop("nested rules");
        continue;
      }
      if (/expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(body)) {
        drop("unsafe values");
        continue;
      }
      rules = scopeRule(splitTop(prelude), body.trim());
      if (!rules.length) {
        drop("rules without a selector");
        continue;
      }
    }
    const length = rules.reduce((n, r) => n + r.length + 1, 0);
    if (size + length > SCOPED_CSS_MAX) {
      drop("CSS over the size limit");
      break;
    }
    size += length;
    out.push(...rules);
  }
  return out;
}

/**
 * One rule's selectors as scoped rules: inside a root (":is(ROOTS) :is(list)") or on a root
 * (":is(list):is(ROOTS)"). :is() ignores selectors the browser doesn't know, so one of them can't
 * drop the others. Pseudo-elements can't go inside :is(): each such selector gets its own rules,
 * with the root check before the pseudo-element.
 */
export function scopeRule(selectors: string[], body: string): string[] {
  const plain: string[] = [];
  const rules: string[] = [];
  for (const raw of selectors) {
    const s = raw.trim().replace(/\s+/g, " ");
    if (!s) continue;
    if (/^[>+~]/.test(s)) {
      // Starts with a combinator ("> .x"): only inside a root.
      rules.push(`${ROOT} ${s}{${body}}`);
      continue;
    }
    const at = pseudoElementAt(s);
    if (at < 0) {
      plain.push(s);
      continue;
    }
    rules.push(`${ROOT} ${s}{${body}}`);
    const head = s.slice(0, at);
    // "::before" alone, or a combinator right before it: no element to check against the roots.
    if (head && !/[ >+~]$/.test(head)) {
      rules.push(`${head}${ROOT}${s.slice(at)}{${body}}`);
    }
  }
  if (plain.length) {
    const list = plain.join(",");
    rules.unshift(`${ROOT} :is(${list}),:is(${list})${ROOT}{${body}}`);
  }
  return rules;
}

/** Where a selector's pseudo-element starts ("::x", or the old ":before" forms), or -1. */
function pseudoElementAt(s: string) {
  const legacy = /^:(before|after|first-line|first-letter)(?![\w-])/i;
  let depth = 0;
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") j++;
    else if (c === '"' || c === "'") {
      const end = stringEnd(s, j);
      if (end < 0) return -1;
      j = end;
    } else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (!depth && c === ":") {
      if (s[j + 1] === ":") return j;
      if (legacy.test(s.slice(j))) return j;
    }
  }
  return -1;
}

function atName(prelude: string) {
  return "@" + (/^@([\w-]+)/.exec(prelude)?.[1] ?? "").toLowerCase();
}

// The scanners below read CSS as the browser does (CSS Syntax): "\" escapes the next character,
// strings end at their quote, and an unescaped line break inside a string makes it invalid.
// Reading it any other way could let a body hide a "}" the browser sees, and escape the scope.

const NEWLINE = /[\n\r\f]/;

/** Comments removed (outside strings and escapes). */
function stripComments(src: string) {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      out += src.slice(i, i + 2);
      i++;
    } else if (c === '"' || c === "'") {
      const end = stringEnd(src, i);
      // An invalid string: keep the rest as is; the rule around it is dropped later.
      if (end < 0) return out + src.slice(i);
      out += src.slice(i, end + 1);
      i = end;
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 1;
      out += " ";
    } else {
      out += c;
    }
  }
  return out;
}

/** Index of the quote closing the string that starts at i; -1 when it isn't closed on its line. */
function stringEnd(src: string, i: number) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") j++;
    else if (c === q) return j;
    else if (NEWLINE.test(c)) return -1;
  }
  return -1;
}

/**
 * First index at or after i of one of the characters, outside strings, escapes and brackets
 * (each bracket closed by its own kind). -1 when there is none, or a string is invalid.
 */
function scanTo(src: string, i: number, chars: string) {
  const open: string[] = [];
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") j++;
    else if (c === '"' || c === "'") {
      const end = stringEnd(src, j);
      if (end < 0) return -1;
      j = end;
    } else if (c === "(" || c === "[") open.push(c === "(" ? ")" : "]");
    else if (c === ")" || c === "]") {
      if (open[open.length - 1] === c) open.pop();
    } else if (!open.length && chars.includes(c)) return j;
  }
  return -1;
}

/** Index of the "}" that closes the "{" at open; -1 when it isn't closed or a string is invalid. */
function matching(src: string, open: number) {
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") j++;
    else if (c === '"' || c === "'") {
      const end = stringEnd(src, j);
      if (end < 0) return -1;
      j = end;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return j;
  }
  return -1;
}

/** A selector list split at its top-level commas. */
function splitTop(list: string) {
  const parts: string[] = [];
  let start = 0;
  for (;;) {
    const comma = scanTo(list, start, ",");
    if (comma === -1) break;
    parts.push(list.slice(start, comma));
    start = comma + 1;
  }
  parts.push(list.slice(start));
  return parts;
}
