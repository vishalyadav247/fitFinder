// My Selection custom icon (specs/storefront.md › My Selection tab): "SVG or PNG, square, at least
// 48 × 48 px, up to 100 KB." Checks the uploaded bytes, not the file name. Pure.

export const ICON_MAX_BYTES = 100 * 1024;
export const ICON_MIN_PX = 48;

export type IconCheck =
  | { ok: true; kind: "png" | "svg"; mimeType: string; extension: string }
  | { ok: false; error: string };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const fail = (error: string): IconCheck => ({ ok: false, error });
const SIZE_ERROR = `The icon must be square and at least ${ICON_MIN_PX} × ${ICON_MIN_PX} px.`;

/** Width and height of an SVG from its viewBox (or width/height), when they can be read. */
function svgSize(root: string): [number, number] | null {
  const viewBox = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(root)?.[1];
  if (viewBox) {
    const n = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (n.length === 4 && n.every(Number.isFinite)) return [n[2], n[3]];
  }
  const w = /\bwidth\s*=\s*["']\s*([\d.]+)\s*(px)?\s*["']/i.exec(root)?.[1];
  const h = /\bheight\s*=\s*["']\s*([\d.]+)\s*(px)?\s*["']/i.exec(root)?.[1];
  return w && h ? [Number(w), Number(h)] : null;
}

const ACTIVE_SVG =
  /<script\b|javascript:|data:|<foreignObject\b|<(animate|animateMotion|animateTransform|set|handler|listener)\b|[\s/"']on[a-z]+\s*=/i;

/** Numeric character references (&#106; &#x6A;) as characters. */
function decodeEntities(text: string): string {
  return text.replace(/&#(x[0-9a-f]{1,6}|\d{1,7});?/gi, (_, n: string) => {
    const code =
      n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

/**
 * Whether the text is an SVG document: an <svg> root after optional whitespace, XML
 * declaration, comments and doctype. A linear scan (a regex with a repeated comment group can
 * backtrack exponentially on crafted input).
 */
export const startsWithSvg = (text: string) => svgRoot(text) !== null;

const MAX_ROOT_TAG = 4096;

/** The <svg …> start tag after the prolog (null when the text isn't an SVG). Linear. */
export function svgRoot(text: string): string | null {
  let i = 0;
  const skipSpace = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  for (;;) {
    skipSpace();
    const rest = text.slice(i, i + 9).toLowerCase();
    let end = -1;
    if (rest.startsWith("<?xml")) end = text.indexOf("?>", i) + 2;
    else if (rest.startsWith("<!--")) end = text.indexOf("-->", i + 4) + 3;
    else if (rest.startsWith("<!doctype")) end = text.indexOf(">", i) + 1;
    else {
      if (!/^<svg[\s>/]/i.test(text.slice(i, i + 5))) return null;
      const close = text.indexOf(">", i);
      return close < 0
        ? ""
        : text.slice(i, Math.min(close + 1, i + MAX_ROOT_TAG));
    }
    if (end <= i) return null; // unterminated
    i = end;
  }
}

export function checkIcon(bytes: Uint8Array): IconCheck {
  if (!bytes.length) return fail("Choose an SVG or PNG file.");
  if (bytes.length > ICON_MAX_BYTES)
    return fail("The file is larger than 100 KB.");

  if (PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    if (bytes.length < 24) return fail("That PNG file can't be read.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width !== height || width < ICON_MIN_PX) return fail(SIZE_ERROR);
    return { ok: true, kind: "png", mimeType: "image/png", extension: "png" };
  }

  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const root = svgRoot(text);
  if (root !== null) {
    // Shown with <img> (scripts don't run there), but Shopify serves the file as it is, so
    // anything that could run when the file is opened directly is refused. Entities are
    // decoded first (&#106;avascript:), and animation elements can set attributes, so they go too.
    if (ACTIVE_SVG.test(decodeEntities(text))) {
      return fail("That SVG has scripts in it. Use a plain SVG or a PNG.");
    }
    const size = svgSize(root);
    // Vector icons scale; only a size that is readable and not square is refused.
    if (size && Math.abs(size[0] - size[1]) > 0.01 * Math.max(...size)) {
      return fail(SIZE_ERROR);
    }
    return {
      ok: true,
      kind: "svg",
      mimeType: "image/svg+xml",
      extension: "svg",
    };
  }
  return fail("Choose an SVG or PNG file.");
}
