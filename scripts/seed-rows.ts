// Seeds synthetic filter rows into the throwaway perf shop (same shop as perf-import.ts), for
// timing Filter data and storefront queries on a big catalogue.
//   npx tsx scripts/seed-rows.ts [rows=727520]
//   npx tsx scripts/perf-import.ts --cleanup      deletes the test shop and its rows
// Rows are generated in SQL (makes × models × years × SKUs); every 3rd SKU gets a product link.
export {};

try {
  process.loadEnvFile(".env");
} catch {
  // environment from the host
}

const total = Number(process.argv[2] ?? 727520);
if (!Number.isInteger(total) || total < 1) {
  throw new Error("usage: tsx scripts/seed-rows.ts [rows]");
}
// SEED_DOMAIN seeds a second shop (to time one shop among others).
const DOMAIN = process.env.SEED_DOMAIN ?? "perf-import.myshopify.com";

const { Prisma } = await import("@prisma/client");
const { default: prisma } = await import("../app/db.server");
const { upsertShopOnInstall } = await import("../app/models/shop.server");
const { applyStoreType } = await import("../app/models/search-config.server");
const { CURRENT, rowHashSql } =
  await import("../app/services/fitment/row-hash.server");

const shop = await upsertShopOnInstall(DOMAIN);
if (!(await prisma.searchConfig.findUnique({ where: { shopId: shop.id } }))) {
  await applyStoreType(shop.id, "automotive", { replace: false });
}
const fields = await prisma.searchField.findMany({
  where: { shopId: shop.id },
  orderBy: { position: "asc" },
});
const lists = fields.filter((f) => f.type === "list");
if (lists.length < 2) throw new Error("expected two Dropdown fields");
const [make, model] = lists;

const t0 = performance.now();
await prisma.$executeRaw`DELETE FROM fitment_rows WHERE shop_id = ${shop.id}`;
// Storefront options cache: new data, new version.
await prisma.$executeRaw`UPDATE search_configs SET data_version = data_version + 1 WHERE shop_id = ${shop.id}`;
await prisma.$executeRaw`DELETE FROM product_links WHERE shop_id = ${shop.id}`;
// 40 makes, 300 models, years 1990-2025, SKUs "SKU-{n % 60000}".
await prisma.$executeRaw`
  INSERT INTO fitment_rows (shop_id, "values", year_from, year_to, attachment, row_hash, updated_at)
  SELECT ${shop.id}, s."values", s.year_from, s.year_to, s.attachment, ${rowHashSql(CURRENT, "s")}, now()
  FROM (
    SELECT jsonb_build_object(
             ${make.id}::text, 'Make ' || (g % 40),
             ${model.id}::text, 'Model ' || (g % 300) || ' ' || (g % 7)) AS "values",
           1990 + (g % 30) AS year_from,
           CASE WHEN g % 5 = 0 THEN NULL ELSE 1990 + (g % 30) + (g % 6) END AS year_to,
           'SKU-' || (g % 60000) || '-' || (g / 60000) AS attachment
    FROM generate_series(1, ${total}) g
  ) s
  ON CONFLICT (shop_id, row_hash) DO NOTHING`;
await prisma.$executeRaw`
  INSERT INTO product_links (id, shop_id, attachment, kind, product_id, method, updated_at)
  SELECT md5(random()::text || a), ${shop.id}, a, 'sku', 'gid://shopify/Product/' || n, 'auto', now()
  FROM (SELECT DISTINCT attachment AS a, row_number() OVER () AS n
        FROM fitment_rows WHERE shop_id = ${shop.id}) x
  WHERE n % 3 = 0`;
await prisma.$executeRaw(Prisma.raw("ANALYZE fitment_rows"));
const rows = await prisma.fitmentRow.count({ where: { shopId: shop.id } });
console.log(
  `seeded ${rows} rows in ${((performance.now() - t0) / 1000).toFixed(1)} s (shop ${shop.id})`,
);
await prisma.$disconnect();
