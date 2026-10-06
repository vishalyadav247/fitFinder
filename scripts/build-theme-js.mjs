// Builds the storefront scripts of the theme app extension from storefront-src/ (ES modules)
// into extensions/fitfinder-theme/assets/, minified: one bundle per place it runs, each under
// Theme Check's AssetSizeAppBlockJavaScript threshold (10,000 bytes).
//   node scripts/build-theme-js.mjs          build
//   node scripts/build-theme-js.mjs --check  fail when an asset is out of date or too big
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const BUNDLES = {
  "ff-search.js": "storefront-src/entry-search.js",
  "ff-product.js": "storefront-src/entry-product.js",
  "ff-embed.js": "storefront-src/entry-embed.js",
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

async function main() {
  const check = process.argv.includes("--check");
  let failed = false;
  for (const [name, entry] of Object.entries(BUNDLES)) {
    const code = await bundle(entry);
    const bytes = Buffer.byteLength(code);
    if (bytes > MAX_BYTES) {
      console.error(`${name}: ${bytes} bytes, over ${MAX_BYTES}`);
      failed = true;
    }
    if (check) {
      const current = await readFile(OUT + name, "utf8").catch(() => "");
      if (current !== code) {
        console.error(`${name} is out of date: run node scripts/build-theme-js.mjs`);
        failed = true;
      }
    } else {
      await writeFile(OUT + name, code);
    }
    console.log(`${name}: ${bytes} bytes`);
  }
  if (failed) process.exit(1);
}

// Run as a script; tests import bundle() only.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
