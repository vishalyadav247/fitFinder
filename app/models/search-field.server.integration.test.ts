// Runs against the real Postgres in DATABASE_URL. Skipped when no database is configured.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { upsertShopOnInstall } from "./shop.server";
import { applyStoreType } from "./search-config.server";
import {
  FieldRuleError,
  MAX_FIELDS,
  applyFieldIntent,
  applyFieldSave,
  listFields,
  type FieldIntent,
} from "./search-field.server";
import { CURRENT, rowHashSql } from "../services/fitment/row-hash.server";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env: rely on the environment
}

const A = "vitest-fields-a.myshopify.com";
const B = "vitest-fields-b.myshopify.com";

describe.skipIf(!process.env.DATABASE_URL)("search fields (Postgres)", () => {
  const db = new PrismaClient();
  let shopA: string;
  let shopB: string;

  const run = (shopId: string, input: FieldIntent) =>
    applyFieldIntent(shopId, input, db);
  const fields = (shopId: string) => listFields(shopId, db);
  const byLabel = async (shopId: string, label: string) =>
    (await fields(shopId)).find((f) => f.label === label)!;
  const rows = (shopId: string) =>
    db.fitmentRow.findMany({ where: { shopId }, orderBy: { id: "asc" } });

  async function addRow(
    shopId: string,
    values: Record<string, string>,
    years: { yearFrom?: number | null; yearTo?: number | null },
    attachment: string,
  ) {
    // Insert, then hash with the app's own formula (rowHashSql), so the test can't drift from it.
    const [{ id }] = await db.$queryRaw<{ id: bigint }[]>`
      INSERT INTO fitment_rows (shop_id, "values", year_from, year_to, attachment, row_hash, updated_at)
      VALUES (${shopId}, ${JSON.stringify(values)}::jsonb, ${years.yearFrom ?? null}::int,
        ${years.yearTo ?? null}::int, ${attachment}, gen_random_uuid()::text, now())
      RETURNING id`;
    await db.$executeRaw`
      UPDATE fitment_rows r SET row_hash = ${rowHashSql(CURRENT, "r")} WHERE r.id = ${id}`;
    return id;
  }

  /** Every row's stored hash equals the hash of its stored content. */
  async function expectHashesFresh(shopId: string) {
    const [{ stale }] = await db.$queryRaw<{ stale: number }[]>`
      SELECT count(*)::int AS stale FROM fitment_rows r
      WHERE r.shop_id = ${shopId} AND r.row_hash <> ${rowHashSql(CURRENT, "r")}`;
    expect(stale).toBe(0);
  }

  beforeEach(async () => {
    await db.shop.deleteMany({ where: { domain: { in: [A, B] } } });
    shopA = (await upsertShopOnInstall(A, db)).id;
    shopB = (await upsertShopOnInstall(B, db)).id;
    // Field rules, not plan limits (billing.integration.test.ts covers those).
    await db.shop.updateMany({
      where: { id: { in: [shopA, shopB] } },
      data: { plan: "pro" },
    });
    await applyStoreType(shopA, "automotive", { replace: false }, db);
    await applyStoreType(shopB, "automotive", { replace: false }, db);
  });

  afterAll(async () => {
    await db.shop.deleteMany({ where: { domain: { in: [A, B] } } });
    await db.$disconnect();
  });

  it("adds a 'New field' Dropdown, not required, at the end", async () => {
    await run(shopA, { intent: "add" });
    const fs = await fields(shopA);
    expect(fs.map((f) => [f.position, f.label, f.type, f.required])).toEqual([
      [0, "Make", "list", true],
      [1, "Year", "year_range", true],
      [2, "Model", "list", true],
      [3, "New field", "list", false],
    ]);
  });

  it("renames; an emptied name keeps the old one", async () => {
    const make = await byLabel(shopA, "Make");
    await run(shopA, { intent: "label", fieldId: make.id, value: " Brand " });
    expect((await fields(shopA))[0].label).toBe("Brand");
    await run(shopA, { intent: "label", fieldId: make.id, value: "  " });
    expect((await fields(shopA))[0].label).toBe("Brand");
  });

  it("stores a custom placeholder; clearing goes back to the default", async () => {
    const make = await byLabel(shopA, "Make");
    await run(shopA, {
      intent: "placeholder",
      fieldId: make.id,
      value: "Pick a brand",
    });
    expect((await fields(shopA))[0].placeholder).toBe("Pick a brand");
    await run(shopA, { intent: "placeholder", fieldId: make.id, value: "" });
    expect((await fields(shopA))[0].placeholder).toBe("");
  });

  it("toggles required", async () => {
    const model = await byLabel(shopA, "Model");
    await run(shopA, { intent: "required", fieldId: model.id, value: false });
    expect((await byLabel(shopA, "Model")).required).toBe(false);
  });

  it("moves up and down; the ends are no-ops", async () => {
    const model = await byLabel(shopA, "Model");
    await run(shopA, { intent: "move", fieldId: model.id, value: "up" });
    expect((await fields(shopA)).map((f) => f.label)).toEqual([
      "Make",
      "Model",
      "Year",
    ]);
    const make = await byLabel(shopA, "Make");
    await run(shopA, { intent: "move", fieldId: make.id, value: "up" });
    expect((await fields(shopA)).map((f) => [f.position, f.label])).toEqual([
      [0, "Make"],
      [1, "Model"],
      [2, "Year"],
    ]);
  });

  it("save bar: adds, edits and reorders in one save (new fields by key)", async () => {
    const [make, year, model] = await fields(shopA);
    await applyFieldSave(
      shopA,
      [
        { intent: "add", key: "new:1" },
        { intent: "label", fieldId: "new:1", value: "Engine" },
        { intent: "required", fieldId: "new:1", value: true },
        { intent: "label", fieldId: make.id, value: "Brand" },
        {
          intent: "order",
          fieldIds: [year.id, make.id, "new:1", model.id],
        },
      ],
      db,
    );
    expect(
      (await fields(shopA)).map((x) => [x.position, x.label, x.required]),
    ).toEqual([
      [0, "Year", true],
      [1, "Brand", true],
      [2, "Engine", true],
      [3, "Model", true],
    ]);
  });

  it("save bar: a refused step leaves nothing changed", async () => {
    const make = await byLabel(shopA, "Make");
    await expect(
      applyFieldSave(
        shopA,
        [
          { intent: "add", key: "new:1" },
          { intent: "label", fieldId: make.id, value: "Brand" },
          // Year is already the Year range.
          { intent: "type", fieldId: make.id, value: "year_range" },
        ],
        db,
      ),
    ).rejects.toThrow("Only one field can be a year range.");
    expect((await fields(shopA)).map((x) => x.label)).toEqual([
      "Make",
      "Year",
      "Model",
    ]);
  });

  it("save bar: the Year range moves to another field in one save", async () => {
    const make = await byLabel(shopA, "Make");
    const year = await byLabel(shopA, "Year");
    await applyFieldSave(
      shopA,
      [
        { intent: "type", fieldId: year.id, value: "list" },
        { intent: "type", fieldId: make.id, value: "year_range" },
      ],
      db,
    );
    expect((await byLabel(shopA, "Make")).type).toBe("year_range");
    expect((await byLabel(shopA, "Year")).type).toBe("list");
  });

  it("save bar: an order that isn't exactly the shop's fields is refused", async () => {
    const mine = await fields(shopA);
    const other = await byLabel(shopB, "Make");
    for (const fieldIds of [
      mine.slice(0, 2).map((x) => x.id),
      [mine[0].id, mine[1].id, other.id],
      [mine[0].id, mine[0].id, mine[1].id],
    ]) {
      await expect(
        applyFieldSave(shopA, [{ intent: "order", fieldIds }], db),
      ).rejects.toBeInstanceOf(FieldRuleError);
    }
  });

  it("can't touch another shop's field", async () => {
    const otherMake = await byLabel(shopB, "Make");
    await expect(
      run(shopA, { intent: "label", fieldId: otherMake.id, value: "Hacked" }),
    ).rejects.toBeInstanceOf(FieldRuleError);
    await expect(
      run(shopA, { intent: "delete", fieldId: otherMake.id }),
    ).rejects.toBeInstanceOf(FieldRuleError);
    expect((await byLabel(shopB, "Make")).label).toBe("Make");
  });

  it("allows only one Year range field", async () => {
    const make = await byLabel(shopA, "Make");
    await expect(
      run(shopA, { intent: "type", fieldId: make.id, value: "year_range" }),
    ).rejects.toThrow("Only one field can be a year range.");
  });

  it("delete removes the field's values, its mapping, dedupes rows and renumbers", async () => {
    const make = await byLabel(shopA, "Make");
    const model = await byLabel(shopA, "Model");
    await addRow(
      shopA,
      { [make.id]: "AUDI", [model.id]: "A6" },
      { yearFrom: 2008, yearTo: 2011 },
      "SKU-1",
    );
    await addRow(
      shopA,
      { [make.id]: "SEAT", [model.id]: "A6" },
      { yearFrom: 2008, yearTo: 2011 },
      "SKU-1",
    );
    await addRow(shopB, { x: "AUDI" }, {}, "SKU-1");
    await db.importMapping.createMany({
      data: [
        { shopId: shopA, columnName: "Hersteller", target: `field:${make.id}` },
        { shopId: shopA, columnName: "Modell", target: `field:${model.id}` },
      ],
    });

    await run(shopA, { intent: "delete", fieldId: make.id });

    expect((await fields(shopA)).map((f) => [f.position, f.label])).toEqual([
      [0, "Year"],
      [1, "Model"],
    ]);
    const left = await rows(shopA);
    expect(left).toHaveLength(1); // the two rows became identical
    expect(left[0].values).toEqual({ [model.id]: "A6" });
    expect(left[0].rowHash).toMatch(/^[0-9a-f]{32}$/);
    const maps = await db.importMapping.findMany({ where: { shopId: shopA } });
    expect(maps.map((m) => m.columnName)).toEqual(["Modell"]);
    expect(await rows(shopB)).toHaveLength(1);
  });

  it("Year range → Dropdown writes years as text and fixes the mapping", async () => {
    const year = await byLabel(shopA, "Year");
    await addRow(shopA, {}, { yearFrom: 2008, yearTo: 2011 }, "A");
    await addRow(shopA, {}, { yearFrom: 2016, yearTo: null }, "B");
    await addRow(shopA, {}, { yearFrom: 2020, yearTo: 2020 }, "C");
    await db.importMapping.createMany({
      data: [
        { shopId: shopA, columnName: "BJVon", target: `field:${year.id}:from` },
        { shopId: shopA, columnName: "BJbis", target: `field:${year.id}:to` },
      ],
    });

    await run(shopA, { intent: "type", fieldId: year.id, value: "list" });

    const r = await rows(shopA);
    expect(r.map((x) => [x.values, x.yearFrom, x.yearTo])).toEqual([
      [{ [year.id]: "2008-2011" }, null, null],
      [{ [year.id]: "2016-" }, null, null],
      [{ [year.id]: "2020" }, null, null],
    ]);
    const maps = await db.importMapping.findMany({ where: { shopId: shopA } });
    expect(maps.map((m) => [m.columnName, m.target])).toEqual([
      ["BJVon", `field:${year.id}`],
    ]);
  });

  it("Dropdown → Year range parses the text back, and refuses non-years", async () => {
    const year = await byLabel(shopA, "Year");
    await run(shopA, { intent: "type", fieldId: year.id, value: "list" });
    await addRow(shopA, { [year.id]: "2008-2011" }, {}, "A");
    await addRow(shopA, { [year.id]: "2016-" }, {}, "B");
    await addRow(shopA, { [year.id]: " 2020 " }, {}, "C");
    await db.importMapping.create({
      data: {
        shopId: shopA,
        columnName: "Bouwjaar",
        target: `field:${year.id}`,
      },
    });

    await run(shopA, { intent: "type", fieldId: year.id, value: "year_range" });

    const r = await rows(shopA);
    expect(r.map((x) => [x.values, x.yearFrom, x.yearTo])).toEqual([
      [{}, 2008, 2011],
      [{}, 2016, null],
      [{}, 2020, 2020],
    ]);
    const maps = await db.importMapping.findMany({ where: { shopId: shopA } });
    expect(maps[0].target).toBe(`field:${year.id}:range`);

    await run(shopA, { intent: "type", fieldId: year.id, value: "list" });
    await addRow(shopA, { [year.id]: "Facelift" }, {}, "D");
    await expect(
      run(shopA, { intent: "type", fieldId: year.id, value: "year_range" }),
    ).rejects.toThrow(
      "1 filter row has a Year value that isn't a year or year range.",
    );
  });

  it("delete merges 3+ identical rows into the lowest id and keeps hashes fresh", async () => {
    const make = await byLabel(shopA, "Make");
    const model = await byLabel(shopA, "Model");
    const first = await addRow(
      shopA,
      { [make.id]: "AUDI", [model.id]: "A6" },
      {},
      "SKU-1",
    );
    await addRow(shopA, { [make.id]: "SEAT", [model.id]: "A6" }, {}, "SKU-1");
    await addRow(shopA, { [make.id]: "SKODA", [model.id]: "A6" }, {}, "SKU-1");
    await addRow(shopA, { [make.id]: "AUDI", [model.id]: "A4" }, {}, "SKU-1");

    await run(shopA, { intent: "delete", fieldId: make.id });

    const r = await rows(shopA);
    expect(r.map((x) => x.values)).toEqual([
      { [model.id]: "A6" },
      { [model.id]: "A4" },
    ]);
    expect(r[0].id).toBe(first);
    await expectHashesFresh(shopA);
  });

  it("deleting the Year range field clears years, merges rows and drops its mapping", async () => {
    const year = await byLabel(shopA, "Year");
    const make = await byLabel(shopA, "Make");
    await addRow(
      shopA,
      { [make.id]: "AUDI" },
      { yearFrom: 2008, yearTo: 2011 },
      "S",
    );
    await addRow(
      shopA,
      { [make.id]: "AUDI" },
      { yearFrom: 2012, yearTo: null },
      "S",
    );
    await db.importMapping.createMany({
      data: [
        { shopId: shopA, columnName: "BJVon", target: `field:${year.id}:from` },
        { shopId: shopA, columnName: "BJbis", target: `field:${year.id}:to` },
        { shopId: shopA, columnName: "Hersteller", target: `field:${make.id}` },
      ],
    });

    await run(shopA, { intent: "delete", fieldId: year.id });

    const r = await rows(shopA);
    expect(r.map((x) => [x.values, x.yearFrom, x.yearTo])).toEqual([
      [{ [make.id]: "AUDI" }, null, null],
    ]);
    const maps = await db.importMapping.findMany({ where: { shopId: shopA } });
    expect(maps.map((m) => m.columnName)).toEqual(["Hersteller"]);
    await expectHashesFresh(shopA);
  });

  it("a type change leaves another shop's rows alone", async () => {
    const yearA = await byLabel(shopA, "Year");
    await addRow(shopA, {}, { yearFrom: 2008, yearTo: 2011 }, "A");
    await addRow(shopB, {}, { yearFrom: 2008, yearTo: 2011 }, "A");
    await run(shopA, { intent: "type", fieldId: yearA.id, value: "list" });
    const b = await rows(shopB);
    expect(b.map((x) => [x.values, x.yearFrom, x.yearTo])).toEqual([
      [{}, 2008, 2011],
    ]);
    await expectHashesFresh(shopA);
    await expectHashesFresh(shopB);
  });

  it.each([
    ["2011-2008", false],
    ["٢٠١٦", false],
    ["", false],
    ["2016 -", true],
    ["2008 - 2011", true],
  ])("Dropdown → Year range with %j: accepted = %s", async (text, ok) => {
    const year = await byLabel(shopA, "Year");
    await run(shopA, { intent: "type", fieldId: year.id, value: "list" });
    await addRow(shopA, { [year.id]: text }, {}, "A");
    const attempt = run(shopA, {
      intent: "type",
      fieldId: year.id,
      value: "year_range",
    });
    if (ok) {
      await attempt;
      await expectHashesFresh(shopA);
    } else {
      await expect(attempt).rejects.toBeInstanceOf(FieldRuleError);
    }
  });

  it("an end year alone converts to text and is refused back", async () => {
    const year = await byLabel(shopA, "Year");
    await addRow(shopA, {}, { yearFrom: null, yearTo: 2011 }, "A");
    await run(shopA, { intent: "type", fieldId: year.id, value: "list" });
    const r = await rows(shopA);
    expect(r.map((x) => [x.values, x.yearFrom, x.yearTo])).toEqual([
      [{ [year.id]: "-2011" }, null, null],
    ]);
  });

  it("concurrent adds keep positions 0..n-1, and the field cap holds", async () => {
    await Promise.all(
      Array.from({ length: 5 }, () => run(shopA, { intent: "add" })),
    );
    const positions = (await fields(shopA)).map((f) => f.position);
    expect(positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    for (let i = positions.length; i < MAX_FIELDS; i++) {
      await run(shopA, { intent: "add" });
    }
    await expect(run(shopA, { intent: "add" })).rejects.toThrow(
      `You can have up to ${MAX_FIELDS} fields.`,
    );
  });

  it("deleting every field leaves an empty, valid setup", async () => {
    for (const f of await fields(shopA)) {
      await run(shopA, { intent: "delete", fieldId: f.id });
    }
    expect(await fields(shopA)).toEqual([]);
  });
});
