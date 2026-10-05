import { Prisma } from "@prisma/client";
import type { PrismaClient, StoreType } from "@prisma/client";
import prisma from "../db.server";
import { z } from "zod";
import { STORE_TYPE_KEYS, buildSetup } from "../services/store-types";

/** Server-only, so zod stays out of the client bundle. */
export const storeTypeSchema = z.enum(STORE_TYPE_KEYS);

/** Onboarding form: { storeType, replace: "true" | "false" }. */
export const setupInputSchema = z.object({
  storeType: storeTypeSchema,
  replace: z.enum(["true", "false"]).transform((v) => v === "true"),
});

type Db = Pick<
  PrismaClient,
  | "$transaction"
  | "searchConfig"
  | "searchField"
  | "fitmentRow"
  | "importMapping"
>;

export class SetupExistsError extends Error {
  constructor() {
    super("This store is already set up. Confirm replacing the setup.");
    this.name = "SetupExistsError";
  }
}

export function getSearchConfig(shopId: string, db: Db = prisma) {
  return db.searchConfig.findUnique({ where: { shopId } });
}

/** What a store type change would delete, for the confirmation modal. */
export async function getSetupCounts(shopId: string, db: Db = prisma) {
  const [fields, rows] = await Promise.all([
    db.searchField.count({ where: { shopId } }),
    db.fitmentRow.count({ where: { shopId } }),
  ]);
  return { fields, rows };
}

/**
 * Creates the search config and default fields for a store type. With `replace`, also deletes
 * the shop's fields, filter rows and saved column mapping (which points at the old field ids).
 * Product links and universal products are kept: they're keyed by attachment / product, not fields.
 *
 * One batch transaction (no interactive-transaction timeout on large row counts). The config row
 * is written first: on a first run a plain create, so a concurrent second submit fails on the
 * unique shop_id and rolls back; on replace an upsert, whose row lock makes a concurrent replace
 * wait, so its deletes then see (and remove) the first one's fields.
 */
export async function applyStoreType(
  shopId: string,
  storeType: StoreType,
  { replace }: { replace: boolean },
  db: Db = prisma,
) {
  const { config, fields } = buildSetup(storeType);
  const where = { where: { shopId } };
  const createFields = db.searchField.createMany({
    data: fields.map((f) => ({ shopId, ...f })),
  });

  if (!replace) {
    try {
      await db.$transaction([
        db.searchConfig.create({ data: { shopId, ...config } }),
        createFields,
      ]);
    } catch (error) {
      if (isUniqueViolation(error)) throw new SetupExistsError();
      throw error;
    }
    return;
  }

  await db.$transaction([
    db.searchConfig.upsert({
      where: { shopId },
      create: { shopId, ...config },
      update: config,
    }),
    db.fitmentRow.deleteMany(where),
    db.importMapping.deleteMany(where),
    db.searchField.deleteMany(where),
    createFields,
  ]);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
