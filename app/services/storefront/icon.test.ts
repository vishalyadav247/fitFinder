import { describe, expect, it } from "vitest";
import { checkIcon, ICON_MAX_BYTES, startsWithSvg } from "./icon";

function png(width: number, height: number, size = 64) {
  const bytes = new Uint8Array(Math.max(size, 24));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
const svg = (text: string) => new TextEncoder().encode(text);

describe("checkIcon", () => {
  it("accepts square PNGs of at least 48 px", () => {
    expect(checkIcon(png(48, 48))).toMatchObject({ ok: true, kind: "png" });
    expect(checkIcon(png(512, 512))).toMatchObject({ ok: true });
  });

  it("refuses small or non-square PNGs", () => {
    expect(checkIcon(png(32, 32)).ok).toBe(false);
    expect(checkIcon(png(64, 48)).ok).toBe(false);
  });

  it("accepts square or unsized SVGs", () => {
    expect(
      checkIcon(
        svg(
          '<?xml version="1.0"?><svg viewBox="0 0 24 24"><path d="M0 0"/></svg>',
        ),
      ),
    ).toMatchObject({ ok: true, kind: "svg", mimeType: "image/svg+xml" });
    expect(checkIcon(svg('<svg width="48px" height="48px"></svg>')).ok).toBe(
      true,
    );
    expect(checkIcon(svg("<svg><circle r='4'/></svg>")).ok).toBe(true);
  });

  it("refuses non-square SVGs and SVGs with scripts", () => {
    expect(checkIcon(svg('<svg viewBox="0 0 48 24"></svg>')).ok).toBe(false);
    expect(checkIcon(svg("<svg><script>alert(1)</script></svg>")).ok).toBe(
      false,
    );
    expect(checkIcon(svg('<svg onload="x()"></svg>')).ok).toBe(false);
    expect(checkIcon(svg('<svg><a href="javascript:x()"/></svg>')).ok).toBe(
      false,
    );
  });

  it("refuses other files, empty files and files over 100 KB", () => {
    expect(checkIcon(svg("GIF89a")).ok).toBe(false);
    expect(checkIcon(new Uint8Array()).ok).toBe(false);
    expect(checkIcon(png(64, 64, ICON_MAX_BYTES + 1))).toEqual({
      ok: false,
      error: "The file is larger than 100 KB.",
    });
  });
});

describe("startsWithSvg", () => {
  it("skips the prolog and finds the svg root", () => {
    expect(
      startsWithSvg('<?xml version="1.0"?>\n<!-- a --><!DOCTYPE svg><svg/>'),
    ).toBe(true);
    expect(startsWithSvg("<svgx>")).toBe(false);
    expect(startsWithSvg("<!-- never closed <svg>")).toBe(false);
  });

  it("stays linear on many comments (no catastrophic backtracking)", () => {
    const start = performance.now();
    expect(startsWithSvg("<!---->".repeat(5000) + "x")).toBe(false);
    expect(checkIcon(svg("<!---->".repeat(40) + "x")).ok).toBe(false);
    // An unclosed root repeated up to the size limit.
    checkIcon(svg("<svg ".repeat(20_000)));
    expect(performance.now() - start).toBeLessThan(200);
  });

  it("refuses entity-encoded scripts and animations", () => {
    expect(
      checkIcon(svg('<svg><a href="&#106;avascript:x()"/></svg>')).ok,
    ).toBe(false);
    expect(checkIcon(svg("<svg/onload=x()>")).ok).toBe(false);
    expect(
      checkIcon(svg('<svg><set attributeName="href" to="x"/></svg>')).ok,
    ).toBe(false);
  });
});
