// Search fields: add, edit in place, reorder, delete (specs/search-setup.md).
// Every write runs in a transaction that first locks the shop's search_configs row, so it can't
// interleave with a store type replace (M2) or another field write.
import { Prisma } from "@prisma/client";
import type { FieldType, PrismaClient, SearchField } from "@prisma/client";
import { z } from "zod";
import prisma from "../db.server";
import {
  LABEL_MAX,
  NEW_FIELD_LABEL,
  PLACEHOLDER_MAX,
  placeholderToStore,
  remapTarget,
  targetsField,
} from "../services/search-fields";
import {
  CURRENT,
  col,
  rewriteRows,
  type RowContent,
} from "../services/fitment/row-hash.server";

type Db = Pick<PrismaClient, "$transaction" | "searchField">;
type Tx = Prisma.TransactionClient;

/** A rule the merchant can fix; the message is shown as an error toast. */
export class FieldRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldRuleError";
  }
}

// Field changes can rewrite every filter row of a shop; allow more than Prisma's 5 s default.
// The statement timeout stops Postgres just before Prisma gives up, so no statement keeps
// running (and holding the shop lock) after the request failed. Large shops move to a
// background job in M4 (PROGRESS.md).
const TX_OPTIONS = { timeout: 120_000, maxWait: 10_000 };
const STATEMENT_TIMEOUT = "110s";

/** Hard cap until plan limits arrive (M9). */
export const MAX_FIELDS = 20;

export class FieldTimeoutError extends Error {
  constructor() {
    super(
      "This change took too long for the amount of filter data and was cancelled. Nothing was changed.",
    );
    this.name = "FieldTimeoutError";
  }
}

export const fieldIntentSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("add") }),
  z.object({
    intent: z.literal("label"),
    fieldId: z.string().min(1),
    value: z.string().max(LABEL_MAX),
  }),
  z.object({
    intent: z.literal("placeholder"),
    fieldId: z.string().min(1),
    value: z.string().max(PLACEHOLDER_MAX),
  }),
  z.object({
    intent: z.literal("type"),
    fieldId: z.string().min(1),
    value: z.enum(["list", "year_range"]),
  }),
  z.object({
    intent: z.literal("required"),
    fieldId: z.string().min(1),
    value: z.enum(["true", "false"]).transform((v) => v === "true"),
  }),
  z.object({
    intent: z.literal("move"),
    fieldId: z.string().min(1),
    value: z.enum(["up", "down"]),
  }),
  z.object({ intent: z.literal("delete"), fieldId: z.string().min(1) }),
]);
export type FieldIntent = z.infer<typeof fieldIntentSchema>;

export function listFields(shopId: string, db: Db = prisma) {
  return db.searchField.findMany({
    where: { shopId },
    orderBy: { position: "asc" },
  });
}

async function lockSetup(tx: Tx, shopId: string) {
  // An import holds this lock while it writes (can take a couple of minutes on big files):
  // say so instead of waiting.
  const running = await tx.importJob.count({
    where: { shopId, status: "running" },
  });
  if (running > 0) {
    throw new FieldRuleError(
      "An import is running. Change your fields when it has finished.",
    );
  }
  const rows = await tx.$queryRaw<unknown[]>`
    UPDATE search_configs SET data_version = data_version + 1
        WHERE shop_id = ${shopId} RETURNING 1`;
  if (rows.length === 0) throw new FieldRuleError("Set up your store first.");
}

async function getField(tx: Tx, shopId: string, fieldId: string) {
  const field = await tx.searchField.findFirst({
    where: { id: fieldId, shopId },
  });
  if (!field) throw new FieldRuleError("This field no longer exists.");
  return field;
}

/** Positions 0..n-1 in the current order (fields are few, so one update each when needed). */
async function renumber(tx: Tx, shopId: string, ordered: SearchField[]) {
  for (const [position, f] of ordered.entries()) {
    if (f.position !== position) {
      await tx.searchField.update({ where: { id: f.id }, data: { position } });
    }
  }
}

async function orderedFields(tx: Tx, shopId: string) {
  return tx.searchField.findMany({
    where: { shopId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
}

export async function applyFieldIntent(
  shopId: string,
  input: FieldIntent,
  db: Db = prisma,
): Promise<void> {
  try {
    await runFieldIntent(shopId, input, db);
  } catch (error) {
    if (isTimeout(error)) throw new FieldTimeoutError();
    throw error;
  }
}

/** Postgres statement timeout (SQLSTATE 57014) or Prisma's transaction timeout (P2028). */
function isTimeout(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return (
      error.code === "P2028" ||
      JSON.stringify(error.meta ?? {}).includes("57014")
    );
  }
  return error instanceof Error && error.message.includes("57014");
}

async function runFieldIntent(shopId: string, input: FieldIntent, db: Db) {
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`,
    );
    await lockSetup(tx, shopId);
    await runStep(tx, shopId, input);
  }, TX_OPTIONS);
}

/**
 * One step of a save bar save. Field ids may be the key of a field added earlier in the same
 * save ("new:1"); "order" lists every field (saved and new) in the new order.
 */
export type SaveStep =
  | { intent: "add"; key: string }
  | Extract<
      FieldIntent,
      { intent: "label" | "placeholder" | "required" | "type" }
    >
  | { intent: "order"; fieldIds: string[] };

/**
 * The save bar's Save: every step in one transaction under the setup lock, so a refused step
 * (FieldRuleError) leaves nothing changed.
 */
export async function applyFieldSave(
  shopId: string,
  steps: SaveStep[],
  db: Db = prisma,
): Promise<void> {
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`,
      );
      await lockSetup(tx, shopId);
      const added = new Map<string, string>();
      const id = (fieldId: string) => added.get(fieldId) ?? fieldId;
      for (const step of steps) {
        if (step.intent === "add") {
          added.set(step.key, await addField(tx, shopId));
        } else if (step.intent === "order") {
          await setOrder(tx, shopId, step.fieldIds.map(id));
        } else {
          await runStep(tx, shopId, { ...step, fieldId: id(step.fieldId) });
        }
      }
    }, TX_OPTIONS);
  } catch (error) {
    if (isTimeout(error)) throw new FieldTimeoutError();
    throw error;
  }
}

async function runStep(tx: Tx, shopId: string, input: FieldIntent) {
  switch (input.intent) {
    case "add":
      return addField(tx, shopId);
    case "label":
      return setLabel(tx, shopId, input.fieldId, input.value);
    case "placeholder":
      return setPlaceholder(tx, shopId, input.fieldId, input.value);
    case "required":
      await getField(tx, shopId, input.fieldId);
      await tx.searchField.update({
        where: { id: input.fieldId },
        data: { required: input.value },
      });
      return;
    case "type":
      return setType(tx, shopId, input.fieldId, input.value);
    case "move":
      return moveField(tx, shopId, input.fieldId, input.value);
    case "delete":
      return deleteField(tx, shopId, input.fieldId);
  }
}

/** Puts the fields in the given order; the list must be exactly the shop's fields. */
async function setOrder(tx: Tx, shopId: string, fieldIds: string[]) {
  const fields = await orderedFields(tx, shopId);
  const byId = new Map(fields.map((f) => [f.id, f]));
  if (
    fieldIds.length !== fields.length ||
    new Set(fieldIds).size !== fieldIds.length ||
    !fieldIds.every((fid) => byId.has(fid))
  ) {
    throw new FieldRuleError(
      "Your fields changed meanwhile. Reload the page and try again.",
    );
  }
  await renumber(
    tx,
    shopId,
    fieldIds.map((fid) => byId.get(fid)!),
  );
}

/** Adds a "New field" at the end; returns its id. */
async function addField(tx: Tx, shopId: string): Promise<string> {
  const position = await tx.searchField.count({ where: { shopId } });
  if (position >= MAX_FIELDS) {
    throw new FieldRuleError(`You can have up to ${MAX_FIELDS} fields.`);
  }
  const field = await tx.searchField.create({
    data: {
      shopId,
      position,
      label: NEW_FIELD_LABEL,
      placeholder: "",
      type: "list",
      required: false,
    },
  });
  return field.id;
}

async function setLabel(tx: Tx, shopId: string, fieldId: string, raw: string) {
  const field = await getField(tx, shopId, fieldId);
  const label = raw.trim();
  // An emptied name keeps the old one (prototype); the page reloads the saved value.
  if (!label || label === field.label) return;
  await tx.searchField.update({ where: { id: fieldId }, data: { label } });
}

async function setPlaceholder(
  tx: Tx,
  shopId: string,
  fieldId: string,
  raw: string,
) {
  const field = await getField(tx, shopId, fieldId);
  await tx.searchField.update({
    where: { id: fieldId },
    data: { placeholder: placeholderToStore(field.label, raw) },
  });
}

async function moveField(
  tx: Tx,
  shopId: string,
  fieldId: string,
  dir: "up" | "down",
) {
  const fields = await orderedFields(tx, shopId);
  const i = fields.findIndex((f) => f.id === fieldId);
  if (i < 0) throw new FieldRuleError("This field no longer exists.");
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= fields.length) return;
  [fields[i], fields[j]] = [fields[j], fields[i]];
  await renumber(tx, shopId, fields);
}

// A year value in a Dropdown column: "2016", "2008-2011" or "2016-" (open range).
// [0-9], not \d: Postgres \d can match non-ASCII digits, which ::int can't cast.
const YEAR_TEXT = "^\\s*[0-9]{4}\\s*(-\\s*([0-9]{4})?\\s*)?$";

async function setType(
  tx: Tx,
  shopId: string,
  fieldId: string,
  type: FieldType,
) {
  const field = await getField(tx, shopId, fieldId);
  if (field.type === type) return;

  if (type === "year_range") {
    // Filter rows hold one year range (year_from / year_to), so one Year range field per store.
    const other = await tx.searchField.count({
      where: { shopId, type: "year_range", id: { not: fieldId } },
    });
    if (other > 0) {
      throw new FieldRuleError("Only one field can be a year range.");
    }
    const [{ bad }] = await tx.$queryRaw<{ bad: number }[]>`
      SELECT count(*)::int AS bad FROM fitment_rows
      WHERE shop_id = ${shopId} AND "values" ? ${fieldId}
        AND (
          NOT ("values"->>${fieldId} ~ ${YEAR_TEXT})
          -- a reversed range ("2011-2008") would never match a year
          OR substring("values"->>${fieldId} from '^\\s*([0-9]{4})')::int >
             coalesce(substring("values"->>${fieldId} from '-\\s*([0-9]{4})\\s*$')::int, 9999)
        )`;
    if (bad > 0) {
      throw new FieldRuleError(
        `${bad.toLocaleString("en")} filter ${bad === 1 ? "row has" : "rows have"} a ${field.label} value that isn't a year or year range. Fix or delete ${bad === 1 ? "it" : "them"} first.`,
      );
    }
    await rewriteRows(
      tx,
      shopId,
      listToYears(fieldId),
      (a) => Prisma.sql`${col(a, "values")} ? ${fieldId}`,
    );
  } else {
    await rewriteRows(tx, shopId, yearsToList(fieldId), hasYears);
  }

  await tx.searchField.update({ where: { id: fieldId }, data: { type } });
  await remapMappings(tx, shopId, (t) => remapTarget(t, fieldId, type));
}

/** Dropdown text "2008-2011" / "2016-" / "2016" → year_from / year_to; key removed from values. */
function listToYears(fieldId: string): RowContent {
  const has = (a: string) => Prisma.sql`(${col(a, "values")} ? ${fieldId})`;
  const text = (a: string) =>
    Prisma.sql`btrim(${col(a, "values")}->>${fieldId})`;
  return {
    values: (a) => Prisma.sql`(${col(a, "values")} - ${fieldId}::text)`,
    yearFrom: (a) => Prisma.sql`CASE WHEN ${has(a)}
      THEN substring(${text(a)} from '^([0-9]{4})')::int
      ELSE ${col(a, "year_from")} END`,
    yearTo: (a) => Prisma.sql`CASE WHEN ${has(a)}
      THEN CASE WHEN ${text(a)} ~ '^[0-9]{4}$' THEN ${text(a)}::int
        ELSE substring(${text(a)} from '-\\s*([0-9]{4})$')::int END
      ELSE ${col(a, "year_to")} END`,
  };
}

/** Rows with any year set (an end year alone counts too). */
const hasYears = (a: string) =>
  Prisma.sql`(${col(a, "year_from")} IS NOT NULL OR ${col(a, "year_to")} IS NOT NULL)`;

/**
 * year_from / year_to → Dropdown text ("2016" when from = to, "2016-" when open, "-2011" when only
 * an end year is set; that last form isn't accepted back as a year range).
 */
function yearsToList(fieldId: string): RowContent {
  return {
    values: (a) => Prisma.sql`CASE
      WHEN ${hasYears(a)} THEN ${col(a, "values")} || jsonb_build_object(${fieldId}::text,
        CASE WHEN ${col(a, "year_to")} = ${col(a, "year_from")}
          THEN ${col(a, "year_from")}::text
          ELSE coalesce(${col(a, "year_from")}::text, '') || '-' || coalesce(${col(a, "year_to")}::text, '')
        END)
      ELSE ${col(a, "values")}
      END`,
    yearFrom: () => Prisma.sql`NULL::int`,
    yearTo: () => Prisma.sql`NULL::int`,
  };
}

async function deleteField(tx: Tx, shopId: string, fieldId: string) {
  const field = await getField(tx, shopId, fieldId);

  if (field.type === "year_range") {
    await rewriteRows(
      tx,
      shopId,
      {
        ...CURRENT,
        yearFrom: () => Prisma.sql`NULL::int`,
        yearTo: () => Prisma.sql`NULL::int`,
      },
      hasYears,
    );
  } else {
    await rewriteRows(
      tx,
      shopId,
      {
        ...CURRENT,
        values: (a) => Prisma.sql`(${col(a, "values")} - ${fieldId}::text)`,
      },
      (a) => Prisma.sql`${col(a, "values")} ? ${fieldId}`,
    );
  }

  await remapMappings(tx, shopId, (t) => (targetsField(t, fieldId) ? null : t));
  await tx.searchField.delete({ where: { id: fieldId } });
  await renumber(tx, shopId, await orderedFields(tx, shopId));
}

/** Applies a target rewrite to the saved import mapping; null drops the column. */
async function remapMappings(
  tx: Tx,
  shopId: string,
  next: (target: string) => string | null,
) {
  const mappings = await tx.importMapping.findMany({ where: { shopId } });
  for (const m of mappings) {
    const target = next(m.target);
    const where = {
      shopId_columnName: { shopId, columnName: m.columnName },
    };
    if (target === null) {
      await tx.importMapping.delete({ where });
    } else if (target !== m.target) {
      await tx.importMapping.update({ where, data: { target } });
    }
  }
}
