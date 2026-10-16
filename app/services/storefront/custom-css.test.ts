// Custom CSS scoping (custom-css.ts): every selector is limited to SpareFit's storefront
// elements, global at-rules are dropped and nothing can close the <style> tag or end a rule
// where the browser would see something else.
import { describe, expect, it } from "vitest";
import {
  CSS_SCOPES,
  CUSTOM_CSS_MAX,
  SCOPED_CSS_MAX,
  scopeCss,
  scopeRule,
} from "./custom-css";

const ROOT = `:is(${CSS_SCOPES.join(",")})`;
const scoped = (list: string, body: string) =>
  `${ROOT} :is(${list}),:is(${list})${ROOT}{${body}}`;

describe("scopeRule", () => {
  it("matches inside a root and on the root itself, in one forgiving rule", () => {
    expect(scopeRule([".sp-sfw__go", " .sp-fit "], "color: red")).toEqual([
      scoped(".sp-sfw__go,.sp-fit", "color: red"),
    ]);
  });

  it("gives pseudo-elements their own rules, with the root check before them", () => {
    expect(scopeRule([".sp-ms__tab::before"], "x")).toEqual([
      `${ROOT} .sp-ms__tab::before{x}`,
      `.sp-ms__tab${ROOT}::before{x}`,
    ]);
    expect(scopeRule(["button:after"], "x")).toEqual([
      `${ROOT} button:after{x}`,
      `button${ROOT}:after{x}`,
    ]);
    // A pseudo-class after the pseudo-element, and pseudo-elements no list knows.
    expect(scopeRule([".sp-ms ::-webkit-scrollbar:horizontal"], "x")).toEqual([
      `${ROOT} .sp-ms ::-webkit-scrollbar:horizontal{x}`,
    ]);
    expect(scopeRule([".sp-fit::highlight(a)"], "x")).toEqual([
      `${ROOT} .sp-fit::highlight(a){x}`,
      `.sp-fit${ROOT}::highlight(a){x}`,
    ]);
    expect(scopeRule(["::selection"], "x")).toEqual([`${ROOT} ::selection{x}`]);
  });

  it("keeps a leading combinator inside a root only", () => {
    expect(scopeRule(["> .sp-sfw"], "x")).toEqual([`${ROOT} > .sp-sfw{x}`]);
  });
});

describe("scopeCss", () => {
  it("scopes every selector of a rule", () => {
    expect(scopeCss(".sp-sfw__go, .sp-fit { color: red; }")).toEqual({
      css: scoped(".sp-sfw__go,.sp-fit", "color: red;"),
      dropped: [],
    });
  });

  it("can't reach the theme: body and h1 only match inside SpareFit", () => {
    const { css } = scopeCss("body { display: none } h1 { color: red }");
    expect(css).toBe(
      [scoped("body", "display: none"), scoped("h1", "color: red")].join("\n"),
    );
  });

  // Inputs that read differently to a careless parser than to the browser. Each would end the
  // first rule early in the browser and apply "body{…}" to the whole storefront.
  it.each([
    [
      "an escaped quote outside a string",
      '.x{a:\\"} body{background:red} .y{b:"}',
    ],
    [
      "a line break inside a string",
      '.x{--a:"\n} body{background:red} .y{--b:"}',
    ],
    [
      "a line break in a single-quoted string",
      ".x{--a:'\n} body{background:red} .y{--b:'}",
    ],
    ["an escaped closing brace", ".x{a:\\} body{background:red} .y{b:c}"],
    ["an escaped opening brace", ".x{a:\\{} body{background:red}"],
    ["an unclosed string at the end", '.x{content:"} body{background:red}'],
    [
      "a bracket closed by the wrong kind",
      ".x{a:[(]} body{background:red} .y{b:)}",
    ],
  ])("never lets %s escape the scope", (_name, input) => {
    const { css } = scopeCss(input);
    // Any surviving "body" must be inside the scoped form.
    for (const m of css.matchAll(/body/g)) {
      expect(
        css.slice(Math.max(0, m.index - ROOT.length - 6), m.index),
      ).toMatch(/:is\($|\(\.sp-search-wrap|:is\(\.x,/);
    }
    expect(css).not.toMatch(/(^|[}\n])\s*body\s*\{/);
  });

  it("drops the rule around an invalid string", () => {
    const { css, dropped } = scopeCss(
      '.x{--a:"\n} body{background:red} .y{--b:"}',
    );
    expect(css).toBe("");
    expect(dropped).toEqual(["an unfinished rule"]);
  });

  it("keeps @media, @supports and @container, scoping their rules", () => {
    expect(
      scopeCss("@media (max-width: 749px) { .sp-sfw { padding: 8px } }").css,
    ).toBe(
      `@media (max-width: 749px){\n${scoped(".sp-sfw", "padding: 8px")}\n}`,
    );
  });

  it("drops @import, @font-face, @keyframes and unknown at-rules", () => {
    const { css, dropped } = scopeCss(
      '@import url("https://x.test/a.css"); @font-face { font-family: X } @keyframes k { to { opacity: 0 } } .sp-fit { color: red }',
    );
    expect(css).toBe(scoped(".sp-fit", "color: red"));
    expect(dropped).toEqual(["@import", "@font-face", "@keyframes"]);
  });

  it("drops nested rules and unsafe values", () => {
    const { css, dropped } = scopeCss(
      ".a { .b { color: red } } .c { width: expression(alert(1)) } .d { background: url(javascript:alert(1)) }",
    );
    expect(css).toBe("");
    expect(dropped).toEqual(["nested rules", "unsafe values"]);
  });

  it("can't close the style tag", () => {
    const { css } = scopeCss(
      '.sp-fit::after { content: "</style><script>alert(1)</script>" }',
    );
    expect(css).not.toContain("<");
    expect(css).toContain("\\3c /style>");
  });

  it("ignores comments, braces in strings and brackets in selectors", () => {
    const { css } = scopeCss(
      '/* a { } */ .sp-fit[data-x="a,b"] { content: "}" }',
    );
    expect(css).toBe(scoped('.sp-fit[data-x="a,b"]', 'content: "}"'));
  });

  it("keeps escapes in selectors and values", () => {
    expect(scopeCss(".sm\\:hidden { content: '\\'' }").css).toBe(
      scoped(".sm\\:hidden", "content: '\\''"),
    );
  });

  it("drops an unfinished rule and text outside rules", () => {
    expect(scopeCss(".sp-fit { color: red").dropped).toEqual([
      "an unfinished rule",
    ]);
    expect(scopeCss("color: red; .sp-fit { color: red }")).toEqual({
      css: scoped(".sp-fit", "color: red"),
      dropped: ["text outside a rule"],
    });
  });

  it("reads at most CUSTOM_CSS_MAX characters and publishes at most SCOPED_CSS_MAX", () => {
    const long = ".sp-fit { color: red }".padEnd(CUSTOM_CSS_MAX + 100, " ");
    expect(scopeCss(long).css).toBe(scoped(".sp-fit", "color: red"));
    // Many pseudo-element selectors on a long body would multiply the size.
    const body = "x".repeat(2000);
    const many = scopeCss(
      `${Array.from({ length: 40 }, (_, i) => `.a${i}::before`).join(",")}{${body}}`,
    );
    expect(many.css.length).toBeLessThanOrEqual(SCOPED_CSS_MAX);
  });

  it("stays fast on pathological input", () => {
    const inputs = [
      "(".repeat(CUSTOM_CSS_MAX),
      "'".repeat(CUSTOM_CSS_MAX),
      "@media{".repeat(700),
      "a{".repeat(2500),
      '"\\'.repeat(2500),
      ",".repeat(CUSTOM_CSS_MAX - 1) + "{}",
    ];
    const start = performance.now();
    for (const input of inputs) scopeCss(input);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("returns nothing for empty input", () => {
    expect(scopeCss("   ")).toEqual({ css: "", dropped: [] });
  });
});
