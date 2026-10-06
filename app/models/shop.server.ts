import { z } from "zod";
import type { PrismaClient, Shop } from "@prisma/client";
import prisma from "../db.server";

type ShopDb = Pick<PrismaClient, "shop">;

const MYSHOPIFY = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** Accepts *.myshopify.com, plus SHOP_CUSTOM_DOMAIN when shopify.server.ts is configured with it. */
export function parseShopDomain(
  domain: string,
  customDomain: string | undefined = process.env.SHOP_CUSTOM_DOMAIN,
): string {
  const custom = customDomain?.trim().toLowerCase();
  return z
    .string()
    .trim()
    .toLowerCase()
    .refine(
      (d) => MYSHOPIFY.test(d) || (!!custom && d === custom),
      "Not a myshopify.com domain",
    )
    .parse(domain);
}

/**
 * Called from the afterAuth hook and the app layout loader: creates the shop, or reactivates it
 * after a reinstall. Atomic, so parallel first loads can't race into a unique-key error.
 */
export async function upsertShopOnInstall(
  domain: string,
  db: ShopDb = prisma,
): Promise<Shop> {
  const parsed = parseShopDomain(domain);
  const now = new Date();

  // Only touches rows that were uninstalled, so installedAt keeps the original install time.
  await db.shop.updateMany({
    where: { domain: parsed, uninstalledAt: { not: null } },
    // A reinstall starts without a plan until the Partner API says otherwise.
    data: {
      uninstalledAt: null,
      installedAt: now,
      plan: "none",
      trialEndsAt: null,
    },
  });
  return db.shop.upsert({
    where: { domain: parsed },
    create: { domain: parsed, installedAt: now, lastAuthAt: now, plan: "none" },
    update: { lastAuthAt: now },
  });
}

const LAST_AUTH_REFRESH_MS = 5 * 60 * 1000;

/**
 * Cheap read for every admin request. Writes only when the row is missing or uninstalled, or to
 * refresh lastAuthAt (at most every 5 minutes): an admin visit proves the app is installed.
 */
export async function ensureShop(
  domain: string,
  db: ShopDb = prisma,
): Promise<Shop> {
  const shop = await db.shop.findUnique({
    where: { domain: parseShopDomain(domain) },
  });
  if (!shop || shop.uninstalledAt) return upsertShopOnInstall(domain, db);
  if (Date.now() - shop.lastAuthAt.getTime() < LAST_AUTH_REFRESH_MS)
    return shop;
  return db.shop.update({
    where: { id: shop.id },
    data: { lastAuthAt: new Date() },
  });
}

/**
 * app/uninstalled webhook. Stamps the shop only if there was no token exchange or admin visit
 * after the uninstall happened: webhooks can be delayed or retried and arrive after a reinstall. Returns true when the shop was marked.
 * Data is kept and purged 30 days later (M10).
 */
export async function markShopUninstalled(
  domain: string,
  triggeredAt: Date,
  db: ShopDb = prisma,
): Promise<boolean> {
  const { count } = await db.shop.updateMany({
    where: {
      domain: parseShopDomain(domain),
      uninstalledAt: null,
      lastAuthAt: { lte: triggeredAt },
    },
    data: { uninstalledAt: triggeredAt },
  });
  return count > 0;
}

export async function getShopByDomain(
  domain: string,
  db: ShopDb = prisma,
): Promise<Shop | null> {
  return db.shop.findUnique({ where: { domain: parseShopDomain(domain) } });
}
