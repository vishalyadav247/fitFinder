// Deletes an uninstalled shop's data now instead of after the 30-day keep window
// (services/purge.server.ts): filter rows, imports, files, settings, plan history and sessions.
// For starting a demo store from scratch, e.g. before recording the screencast.
//   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/purge-shop.ts <shop>.myshopify.com
// Refuses an installed shop: uninstall the app first.
export {};

try {
  process.loadEnvFile(".env");
} catch {
  // environment from the host
}

const domain = (process.argv[2] ?? "").trim().toLowerCase();
if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
  console.error("usage: tsx scripts/purge-shop.ts <shop>.myshopify.com");
  process.exit(1);
}

const { default: prisma } = await import("../app/db.server");
const { purgeShop } = await import("../app/services/purge.server");

const shop = await prisma.shop.findUnique({
  where: { domain },
  select: { id: true, domain: true, uninstalledAt: true },
});
if (!shop) {
  console.log(`${domain}: no data stored, nothing to delete`);
} else if (!shop.uninstalledAt) {
  console.error(
    `${domain} is still installed. Uninstall the app from the store first, then run this again.`,
  );
  process.exitCode = 1;
} else if (await purgeShop(shop)) {
  console.log(`${domain}: all data deleted. The next install starts fresh.`);
} else {
  console.error(`${domain} was reinstalled meanwhile; nothing deleted.`);
  process.exitCode = 1;
}
await prisma.$disconnect();
