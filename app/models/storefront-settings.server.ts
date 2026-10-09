// Storefront page writes (specs/storefront.md): one setting at a time into
// storefront_settings.settings, and the search heading (search_configs.heading). Every write is
// scoped by shop; a setting is merged into the stored document in one statement, so two quick
// changes of different settings can't overwrite each other.
import { z } from "zod";
import prisma from "../db.server";
import {
  EDITABLE_KEYS,
  parseSettingValue,
  TEXT_MAX,
} from "../services/storefront/settings";

export const storefrontIntentSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("setting"),
    key: z.enum(EDITABLE_KEYS),
    // JSON of the value (a string, boolean or the tableHide object).
    value: z.string().max(5000),
  }),
  z.object({
    intent: z.literal("heading"),
    value: z.string().trim().min(1).max(TEXT_MAX),
  }),
  z.object({ intent: z.literal("publish") }),
  // The save bar's Save: every changed setting (JSON values) and the heading, in one request.
  z.object({
    intent: z.literal("save"),
    settings: z
      .partialRecord(z.enum(EDITABLE_KEYS), z.string().max(5000))
      .refine((s) => Object.keys(s).length <= EDITABLE_KEYS.length),
    heading: z.string().trim().min(1).max(TEXT_MAX).optional(),
  }),
]);

export type StorefrontIntent = z.infer<typeof storefrontIntentSchema>;

export class SettingValueError extends Error {
  constructor() {
    super("That value can't be used.");
    this.name = "SettingValueError";
  }
}

/** Parses the JSON value of a setting intent; throws SettingValueError when it isn't valid. */
export function settingValue(key: string, json: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new SettingValueError();
  }
  const value = parseSettingValue(key, raw);
  if (value === null) throw new SettingValueError();
  return value;
}

/** Merges settings into the shop's stored document. */
export async function saveSettings(
  shopId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO storefront_settings (shop_id, settings, updated_at)
    VALUES (${shopId}, ${JSON.stringify(patch)}::jsonb, now())
    ON CONFLICT (shop_id) DO UPDATE
      SET settings = storefront_settings.settings || EXCLUDED.settings,
          updated_at = now()`;
}

export async function saveHeading(shopId: string, heading: string) {
  await prisma.searchConfig.update({
    where: { shopId },
    data: { heading },
  });
}
