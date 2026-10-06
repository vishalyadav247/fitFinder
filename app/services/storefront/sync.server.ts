// Publishes the storefront config (config.ts) to an app-data metafield on the app installation,
// which the theme app extension reads as app.metafields.fitfinder.config. Runs from the admin
// layout loader, the Storefront page and after every Storefront setting change, and only writes
// when the document changed since the last publish (hash in storefront_settings.published_hash).
// One publish per shop at a time (a lease in storefront_settings.publishing_until); the holder
// re-checks after releasing it, so the newest document is written last.
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
// A publish lease outlives the slowest pair of Admin API calls (throttle retries included).
const LEASE_SECONDS = 90;
// Publishes again when the config changed while the lease was held.
const MAX_ROUNDS = 3;

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

/**
 * The config, its JSON and the hash of what the theme should have. The hash covers the install
 * time too: a reinstall gets a new app installation without our metafield, so the same config
 * must be written again.
 */
async function publishState(shopId: string) {
  const [config, current, shop] = await Promise.all([
    loadStorefrontConfig(shopId),
    prisma.storefrontSettings.findUnique({
      where: { shopId },
      select: { publishedHash: true },
    }),
    prisma.shop.findUnique({
      where: { id: shopId },
      select: { installedAt: true },
    }),
  ]);
  if (!config || !shop) return null;
  const json = JSON.stringify(config);
  const hash = configHash(`${shop.installedAt.toISOString()}
${json}`);
  return { json, hash, published: current?.publishedHash === hash };
}

/** Whether the theme has the current settings (false: a publish failed or is due). */
export async function storefrontConfigPublished(shopId: string) {
  const state = await publishState(shopId);
  return !state || state.published;
}

async function writeMetafield(gql: AdminGraphql, json: string) {
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
}

/**
 * Claims the shop's publish lease (one statement). Returns the lease (its expiry, compared as
 * text so the fence matches exactly) or null when another publish holds it.
 */
async function claimLease(shopId: string): Promise<string | null> {
  await prisma.$executeRaw`
    INSERT INTO storefront_settings (shop_id, updated_at) VALUES (${shopId}, now())
    ON CONFLICT (shop_id) DO NOTHING`;
  const rows = await prisma.$queryRaw<{ lease: string }[]>`
    UPDATE storefront_settings
    SET publishing_until = now() + make_interval(secs => ${LEASE_SECONDS})
    WHERE shop_id = ${shopId}
      AND (publishing_until IS NULL OR publishing_until < now())
    RETURNING publishing_until::text AS lease`;
  return rows[0]?.lease ?? null;
}

/** Records the hash only while the lease is still ours and unexpired (fenced). */
async function recordPublished(shopId: string, lease: string, hash: string) {
  const updated = await prisma.$executeRaw`
    UPDATE storefront_settings SET published_hash = ${hash}
    WHERE shop_id = ${shopId} AND publishing_until::text = ${lease}
      AND publishing_until > now()`;
  return updated === 1;
}

/**
 * Releases the lease if it is still ours. A holder that outlived its lease can't tell whether its
 * write landed after a newer publish's, so it forgets the published hash: the next check writes
 * the newest config again (an extra write, never a stale theme).
 */
async function releaseLease(shopId: string, lease: string) {
  const released = await prisma.$executeRaw`
    UPDATE storefront_settings SET publishing_until = NULL
    WHERE shop_id = ${shopId} AND publishing_until::text = ${lease}
      AND publishing_until > now()`;
  if (released === 0) {
    await prisma.$executeRaw`
      UPDATE storefront_settings SET published_hash = NULL WHERE shop_id = ${shopId}`;
  }
}

/**
 * Writes the config when it changed. Returns whether it wrote. One publish per shop at a time
 * (a lease, not a lock: no connection or transaction stays open while Shopify answers). A
 * publish that finds the lease taken returns at once; the holder checks again after releasing
 * it, so a change saved meanwhile is still written, and the newest config is written last.
 */
export async function publishStorefrontConfig(
  gql: AdminGraphql,
  shopId: string,
): Promise<boolean> {
  let wrote = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const state = await publishState(shopId);
    if (!state || state.published) return wrote;
    const lease = await claimLease(shopId);
    if (!lease) return wrote;
    try {
      // Inside the lease: the newest config.
      const current = await publishState(shopId);
      if (!current || current.published) return wrote;
      if (Buffer.byteLength(current.json) > MAX_BYTES) {
        throw new ShopifyApiError("The storefront settings are too large.");
      }
      await writeMetafield(gql, current.json);
      if (await recordPublished(shopId, lease, current.hash)) wrote = true;
    } finally {
      await releaseLease(shopId, lease);
    }
  }
  return wrote;
}

export type PublishOutcome = "published" | "pending" | "behind";

/**
 * Publishes and says where the theme stands: "pending" when another request is publishing right
 * now (it re-checks when done), "behind" when the theme doesn't have the current settings.
 * Throws like publishStorefrontConfig.
 */
export async function publishWithOutcome(
  gql: AdminGraphql,
  shopId: string,
): Promise<PublishOutcome> {
  await publishStorefrontConfig(gql, shopId);
  if (await storefrontConfigPublished(shopId)) return "published";
  const busy = await prisma.storefrontSettings.count({
    where: { shopId, publishingUntil: { gt: new Date() } },
  });
  return busy ? "pending" : "behind";
}
