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
 * First run: one batch transaction that writes the config row first (a plain create), so a
 * concurrent second submit fails on the unique shop_id and rolls back. Replace: under the setup
 * lock (withSetupLock), so a concurrent replace waits and then sees (and removes) the first one's
 * fields, and a running import refuses it with a FitmentRuleError.
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

  // Under the setup lock like every other write that changes fields or rows: refused while an
  // import is running (its apply holds the lock for minutes), with lock and statement timeouts, so
  // the merchant gets an answer instead of a hung request whose deletes run later.
  const { withSetupLock } = await import("./fitment-row.server");
  const exists = await db.searchConfig.findUnique({
    where: { shopId },
    select: { shopId: true },
  });
  if (!exists) return applyStoreType(shopId, storeType, { replace: false }, db);
  await withSetupLock(shopId, async (tx) => {
    // The lock already bumped data_version (the storefront options cache).
    await tx.searchConfig.update({ where: { shopId }, data: config });
    await tx.fitmentRow.deleteMany(where);
    await tx.importMapping.deleteMany(where);
    await tx.searchField.deleteMany(where);
    await tx.searchField.createMany({
      data: fields.map((f) => ({ shopId, ...f })),
    });
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
