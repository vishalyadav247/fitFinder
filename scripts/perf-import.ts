// Times the import pipeline on a big CSV against the local Postgres (throwaway test shop).
//   npx tsx scripts/perf-import.ts <file.csv> [upsert|replace|delete]
//   npx tsx scripts/perf-import.ts --cleanup      deletes the test shop and its rows
// Runs the check run and the import directly (no queue) and prints timings and counts.
import { createReadStream } from "node:fs";
import path from "node:path";

try {
  process.loadEnvFile(".env");
} catch {
  // environment from the host
}

const [file, modeArg] = process.argv.slice(2);
if (!file)
  throw new Error("usage: tsx scripts/perf-import.ts <file.csv> [mode]");
const DOMAIN = "perf-import.myshopify.com";

if (file === "--cleanup") {
  const { default: db } = await import("../app/db.server");
  const r = await db.shop.deleteMany({ where: { domain: DOMAIN } });
  console.log(`deleted test shop: ${r.count}`);
  await db.$disconnect();
  process.exit(0);
}
const mode = (modeArg ?? "upsert") as "upsert" | "replace" | "delete";

const { default: prisma } = await import("../app/db.server");
const { upsertShopOnInstall } = await import("../app/models/shop.server");
const { applyStoreType } = await import("../app/models/search-config.server");
const { newUploadKey, storage } =
  await import("../app/services/storage.server");
const pipeline = await import("../app/services/import/pipeline.server");

const t = () => performance.now();
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

const shop = await upsertShopOnInstall(DOMAIN);
if (!(await prisma.searchConfig.findUnique({ where: { shopId: shop.id } }))) {
  await applyStoreType(shop.id, "automotive", { replace: false });
}

const key = newUploadKey(shop.id, path.basename(file));
let t0 = t();
await storage().put(key, createReadStream(file));
console.log(`store file     ${secs(t() - t0)}`);

t0 = t();
const { job, choices } = await pipeline.createImport(shop.id, {
  key,
  fileName: path.basename(file),
  mode,
});
console.log(
  `read preview   ${secs(t() - t0)}  mapping: ${JSON.stringify(choices)}`,
);

await pipeline.saveMapping(shop.id, job.id, {
  choices,
  hasHeader: true,
  lookForSkus: true,
  mode,
});
t0 = t();
await pipeline.runPreview(job.id);
let j = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
console.log(
  `check run      ${secs(t() - t0)}  status=${j.status} rows=${j.totalRows} added=${j.added} unchanged=${j.unchanged} deleted=${j.deleted} imported=${j.imported} notFound=${j.notFound} errors=${j.errors} ${j.failureReason ?? ""}`,
);

t0 = t();
await pipeline.startRun(shop.id, job.id);
await pipeline.runImport(job.id);
j = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
console.log(
  `import         ${secs(t() - t0)}  status=${j.status} added=${j.added} unchanged=${j.unchanged} deleted=${j.deleted} imported=${j.imported} errors=${j.errors} ${j.failureReason ?? ""}`,
);
console.log(
  `filter rows now: ${await prisma.fitmentRow.count({ where: { shopId: shop.id } })}`,
);
await prisma.$disconnect();
