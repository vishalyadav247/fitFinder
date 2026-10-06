// Builds the storefront scripts and styles of the theme app extension from storefront-src/ into
// extensions/fitfinder-theme/assets/, minified: one bundle per place it runs, so a page loads
// only what it shows. JS bundles stay under Theme Check's AssetSizeAppBlockJavaScript threshold
// (10,000 bytes). The embed's stylesheet loads on every page and blocks rendering, so it holds
// only the save prompt and My Selection; blocks bring their own.
//   node scripts/build-theme-js.mjs          build
//   node scripts/build-theme-js.mjs --check  fail when an asset is out of date or too big
import { build, transform } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const BUNDLES = {
  "ff-search.js": "storefront-src/entry-search.js",
  "ff-product.js": "storefront-src/entry-product.js",
  "ff-embed.js": "storefront-src/entry-embed.js",
};

const CSS = "storefront-src/css/";
/** Stylesheets: concatenated source parts. */
export const STYLES = {
  "ff-embed.css": ["base.css", "ask.css", "my-selection.css"],
  "ff-search.css": ["base.css", "search.css", "ask.css"],
  "ff-product.css": ["base.css", "product.css"],
};

export const MAX_BYTES = 10_000;
export const OUT = "extensions/fitfinder-theme/assets/";

export async function bundle(entry) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2019",
    write: false,
    legalComments: "none",
  });
  return result.outputFiles[0].text;
}

export async function styles(parts) {
  const source = (
    await Promise.all(parts.map((p) => readFile(CSS + p, "utf8")))
  ).join("\n");
  const { code } = await transform(source, { loader: "css", minify: true });
  return code;
}

async function main() {
  const check = process.argv.includes("--check");
  let failed = false;
  const outputs = [
    ...Object.entries(BUNDLES).map(([name, entry]) => [
      name,
      () => bundle(entry),
      true,
    ]),
    ...Object.entries(STYLES).map(([name, parts]) => [
      name,
      () => styles(parts),
      false,
    ]),
  ];
  for (const [name, make, limited] of outputs) {
    const code = await make();
    const bytes = Buffer.byteLength(code);
    if (limited && bytes > MAX_BYTES) {
      console.error(`${name}: ${bytes} bytes, over ${MAX_BYTES}`);
      failed = true;
    }
    if (check) {
      const current = await readFile(OUT + name, "utf8").catch(() => "");
      if (current !== code) {
        console.error(
          `${name} is out of date: run node scripts/build-theme-js.mjs`,
        );
        failed = true;
      }
    } else {
      await writeFile(OUT + name, code);
    }
    console.log(`${name}: ${bytes} bytes`);
  }
  if (failed) process.exit(1);
}

// Run as a script; tests import bundle() and styles() only.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
