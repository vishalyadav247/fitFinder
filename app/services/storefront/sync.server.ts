// Publishes the storefront config (config.ts) to an app-data metafield on the app installation,
// which the theme app extension reads as app.metafields.fitfinder.config. Runs from the admin
// layout loader and only writes when the document changed since the last publish (hash in
// storefront_settings.published_hash), so field edits, a store type change or (M8) a settings
// change reach the theme on the next admin load.
// Docs: https://shopify.dev/docs/apps/build/metafields (app-data metafields; no extra scope),
// https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/metafieldsSet (json ≤ 128 KB).
import { createHash } from "node:crypto";
import prisma from "../../db.server";
import {
  gqlData,
  ShopifyApiError,
  type AdminGraphql,
} from "../linking/catalog.server";
import {
  buildStorefrontConfig,
  CONFIG_KEY,
  CONFIG_NAMESPACE,
  type StorefrontConfig,
} from "./config";

const MAX_BYTES = 120_000;

/** The shop's current storefront config, or null before onboarding. */
export async function loadStorefrontConfig(
  shopId: string,
): Promise<StorefrontConfig | null> {
  const [config, fields, settings] = await Promise.all([
    prisma.searchConfig.findUnique({ where: { shopId } }),
    prisma.searchField.findMany({ where: { shopId } }),
    prisma.storefrontSettings.findUnique({ where: { shopId } }),
  ]);
  if (!config) return null;
  return buildStorefrontConfig({
    config,
    fields,
    stored: settings?.settings,
  });
}

export const configHash = (json: string) =>
  createHash("sha256").update(json).digest("hex");

const INSTALLATION = `#graphql
  query AppInstallationId { currentAppInstallation { id } }`;

const SET_METAFIELD = `#graphql
  mutation SetAppDataMetafield($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message code }
    }
  }`;

/** Writes the config when it changed. Returns whether it wrote. */
export async function publishStorefrontConfig(
  gql: AdminGraphql,
  shopId: string,
): Promise<boolean> {
  const config = await loadStorefrontConfig(shopId);
  if (!config) return false;
  const json = JSON.stringify(config);
  if (Buffer.byteLength(json) > MAX_BYTES) {
    throw new ShopifyApiError("The storefront settings are too large.");
  }
  const hash = configHash(json);
  const [current, shop] = await Promise.all([
    prisma.storefrontSettings.findUnique({
      where: { shopId },
      select: { publishedHash: true, updatedAt: true },
    }),
    prisma.shop.findUnique({
      where: { id: shopId },
      select: { installedAt: true },
    }),
  ]);
  // Same document, written since the latest install. A reinstall gets a new app installation
  // without our metafield (installedAt is reset then), so it is written again.
  if (
    current?.publishedHash === hash &&
    shop &&
    current.updatedAt >= shop.installedAt
  ) {
    return false;
  }

  const { currentAppInstallation } = await gqlData<{
    currentAppInstallation: { id: string };
  }>(gql, INSTALLATION);
  const { metafieldsSet } = await gqlData<{
    metafieldsSet: { userErrors: { message: string }[] };
  }>(gql, SET_METAFIELD, {
    metafields: [
      {
        ownerId: currentAppInstallation.id,
        namespace: CONFIG_NAMESPACE,
        key: CONFIG_KEY,
        type: "json",
        value: json,
      },
    ],
  });
  if (metafieldsSet.userErrors.length) {
    throw new ShopifyApiError(
      `Storefront settings not saved: ${metafieldsSet.userErrors.map((e) => e.message).join("; ")}`,
    );
  }
  await prisma.storefrontSettings.upsert({
    where: { shopId },
    create: { shopId, publishedHash: hash },
    update: { publishedHash: hash },
  });
  return true;
}
