// Times the storefront (app proxy) and Dashboard queries on the big perf shop (M10).
//   npx tsx scripts/seed-rows.ts            727,520 rows + links (perf-import.myshopify.com)
//   npx tsx scripts/perf-storefront.ts      fills a matching catalog, then times each query
//   npx tsx scripts/perf-import.ts --cleanup   deletes the perf shop afterwards
// Each query runs 3 times; the options cache is cleared before the "cold" runs.
export {};

try {
  process.loadEnvFile(".env");
} catch {
  // environment from the host
}

const DOMAIN = process.env.SEED_DOMAIN ?? "perf-import.myshopify.com";
const { Prisma } = await import("@prisma/client");
const { default: prisma } = await import("../app/db.server");
const q = await import("../app/services/storefront/query.server");
const { parsePicks } = await import("../app/services/storefront/picks");
const { rowCounts } = await import("../app/models/fitment-row.server");
const { productsWithoutDataCount } =
  await import("../app/models/product-link.server");
const { linkedProductCount } = await import("../app/services/billing.server");
const { coverage } = await import("../app/services/dashboard.server");

const shop = await prisma.shop.findUnique({ where: { domain: DOMAIN } });
if (!shop) throw new Error(`run scripts/seed-rows.ts first (${DOMAIN})`);
const shopId = shop.id;

// A catalog for the linked products (worst case: one product per linked SKU).
const catalog = await prisma.catalogProduct.count({ where: { shopId } });
if (catalog === 0) {
  const t = performance.now();
  await prisma.$executeRaw`
    INSERT INTO catalog_products (shop_id, product_id, title, handle, status, updated_at)
    SELECT DISTINCT ${shopId}, l.product_id, 'Product ' || split_part(l.product_id, '/', 5),
           'product-' || split_part(l.product_id, '/', 5), 'ACTIVE', now()
    FROM product_links l WHERE l.shop_id = ${shopId} AND l.product_id IS NOT NULL
    ON CONFLICT DO NOTHING`;
  await prisma.$executeRaw`
    INSERT INTO catalog_variants (shop_id, variant_id, product_id, sku)
    SELECT ${shopId}, replace(l.product_id, 'Product', 'ProductVariant'), l.product_id, l.attachment
    FROM product_links l WHERE l.shop_id = ${shopId} AND l.product_id IS NOT NULL
    ON CONFLICT DO NOTHING`;
  await prisma.$executeRaw(Prisma.raw("ANALYZE catalog_products"));
  await prisma.$executeRaw(Prisma.raw("ANALYZE catalog_variants"));
  console.log(
    `catalog filled in ${((performance.now() - t) / 1000).toFixed(1)} s`,
  );
}

const search = (await q.shopSearch(DOMAIN))!;
const [make, year, model] = search.fields;
const picks = (query: Record<string, string>) =>
  parsePicks(new URLSearchParams(query), search.fields)!;

async function time(label: string, work: () => Promise<unknown>, runs = 3) {
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await work();
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  console.log(
    `${label.padEnd(44)} median ${ms[Math.floor(ms.length / 2)].toFixed(0).padStart(6)} ms   (min ${ms[0].toFixed(0)}, max ${ms[ms.length - 1].toFixed(0)})`,
  );
}

const rows = await prisma.fitmentRow.count({ where: { shopId } });
console.log(`\nshop ${DOMAIN}: ${rows.toLocaleString("en")} rows\n`);
console.log("— storefront (app proxy) —");
await time("shopSearch (every proxy request)", () => q.shopSearch(DOMAIN));

// A real selection from the data.
const first = await prisma.fitmentRow.findFirstOrThrow({
  where: { shopId },
  select: { values: true, yearFrom: true, attachment: true },
});
const v = first.values as Record<string, string>;
const full = picks({
  [make.id]: v[make.id],
  [year.id]: String(first.yearFrom),
  [model.id]: v[model.id],
});

for (const [label, index, p] of [
  ["options: Make (no picks)", 0, picks({})],
  ["options: Year (Make picked)", 1, picks({ [make.id]: v[make.id] })],
  [
    "options: Model (Make + Year)",
    2,
    picks({ [make.id]: v[make.id], [year.id]: String(first.yearFrom) }),
  ],
] as const) {
  await time(`${label} — cold`, async () => {
    q.clearOptionsCache();
    await q.fieldOptions(search, index, p);
  });
  await time(`${label} — cached`, () => q.fieldOptions(search, index, p));
}

const link = await prisma.productLink.findFirstOrThrow({
  where: { shopId, productId: { not: null } },
});
await time("fits (badge + table), no picks", () =>
  q.productFits(search, link.productId!, [], picks({})),
);
await time("fits (badge + table), full selection", () =>
  q.productFits(search, link.productId!, [], full),
);
await time("search: SKUs that fit (theme search)", () =>
  q.fitSkus(search, full, 100),
);
await time("results page 1", () => q.searchResults(search, full, 1));

console.log("\n— dashboard —");
await time("rowCounts (rows, SKUs, unlinked)", () => rowCounts(shopId));
await time("coverage (distinct values, 3 fields)", () =>
  coverage(
    shopId,
    search.fields.map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type === "year_range" ? ("years" as const) : ("list" as const),
    })),
  ),
);
await time("products without filter data", () =>
  productsWithoutDataCount(shopId),
);
await time("linked products (plan meter)", () => linkedProductCount(shopId));

console.log("\n— plan of the slowest storefront query (options: Model) —");
const where = q.picksWhere(
  search.fields,
  picks({ [make.id]: v[make.id], [year.id]: String(first.yearFrom) }),
);
const plan = await prisma.$queryRaw<{ "QUERY PLAN": string }[]>`
  EXPLAIN (ANALYZE, BUFFERS)
  SELECT DISTINCT f."values"->>${model.id} AS v FROM fitment_rows f
  WHERE f.shop_id = ${shopId} ${where}`;
console.log(plan.map((r) => r["QUERY PLAN"]).join("\n"));
await prisma.$disconnect();
