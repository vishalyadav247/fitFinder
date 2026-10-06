// Storefront performance impact as Shopify measures it (Built for Shopify / App Store: an app may
// lower the storefront Lighthouse performance score by at most 10 points). Weighted average of the
// home (17%), product (40%) and collection (43%) pages, via the PageSpeed Insights API (mobile).
// Docs: https://shopify.dev/docs/apps/build/performance/storefront
//
// 1. Without FitFinder (app embed off, no blocks):
//      node scripts/lighthouse-impact.mjs --label before --home URL --product URL --collection URL
// 2. With FitFinder (embed on, search section, fits badge and fitment table added):
//      node scripts/lighthouse-impact.mjs --label after  --home URL --product URL --collection URL
// The second run prints the difference. URLs: Online Store › Themes › right-click "View your
// store" (a preview link PageSpeed can open on a password-protected dev store); add the product
// and collection paths. Optional: --runs 3 (median per page), PSI_API_KEY=… for higher quotas.
import { mkdir, readFile, writeFile } from "node:fs/promises";

export const WEIGHTS = { home: 0.17, product: 0.4, collection: 0.43 };
export const MAX_DROP = 10;
const OUT = ".data/lighthouse/";

export function weighted(scores) {
  return Object.entries(WEIGHTS).reduce(
    (sum, [page, w]) => sum + w * scores[page],
    0,
  );
}

export const median = (values) => {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2)
    out[argv[i].replace(/^--/, "")] = argv[i + 1];
  return out;
}

async function score(url) {
  const api = new URL(
    "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
  );
  api.searchParams.set("url", url);
  api.searchParams.set("category", "performance");
  api.searchParams.set("strategy", "mobile");
  if (process.env.PSI_API_KEY)
    api.searchParams.set("key", process.env.PSI_API_KEY);
  const res = await fetch(api, { signal: AbortSignal.timeout(120_000) });
  const body = await res.json();
  const value = body?.lighthouseResult?.categories?.performance?.score;
  if (!res.ok || typeof value !== "number") {
    throw new Error(
      `PageSpeed failed for ${url}: ${JSON.stringify(body?.error ?? res.status).slice(0, 300)}`,
    );
  }
  return Math.round(value * 100);
}

async function main() {
  const a = args(process.argv.slice(2));
  const runs = Number(a.runs ?? 3);
  if (!a.label || !a.home || !a.product || !a.collection) {
    console.error(
      "usage: node scripts/lighthouse-impact.mjs --label before|after --home URL --product URL --collection URL [--runs 3]",
    );
    process.exit(2);
  }
  const scores = {};
  for (const page of Object.keys(WEIGHTS)) {
    const all = [];
    for (let i = 0; i < runs; i++) all.push(await score(a[page]));
    scores[page] = median(all);
    console.log(`${page}: ${all.join(", ")} → median ${scores[page]}`);
  }
  const total = Math.round(weighted(scores) * 10) / 10;
  console.log(`weighted score (${a.label}): ${total}`);
  await mkdir(OUT, { recursive: true });
  await writeFile(
    `${OUT}${a.label}.json`,
    JSON.stringify({ at: new Date().toISOString(), scores, total }, null, 2),
  );

  const other =
    a.label === "after" ? "before" : a.label === "before" ? "after" : null;
  const saved =
    other && (await readFile(`${OUT}${other}.json`, "utf8").catch(() => null));
  if (saved) {
    const before = a.label === "after" ? JSON.parse(saved).total : total;
    const after = a.label === "after" ? total : JSON.parse(saved).total;
    const drop = Math.round((before - after) * 10) / 10;
    console.log(
      `impact: ${drop > 0 ? "-" : "+"}${Math.abs(drop)} points (limit: -${MAX_DROP}) → ${drop <= MAX_DROP ? "PASS" : "FAIL"}`,
    );
    if (drop > MAX_DROP) process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())
) {
  await main();
}
