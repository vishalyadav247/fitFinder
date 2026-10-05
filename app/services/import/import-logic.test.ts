import { describe, expect, it } from "vitest";
import {
  cleanValue,
  parseYearCell,
  parseYearRangeCell,
  yearsFromCells,
} from "./clean";
import {
  ATTACHMENT,
  SKIP,
  guessChoices,
  normalizeHeader,
  pickColumn,
  resolveChoices,
  targetToChoice,
  targetToString,
  validateChoices,
  type MapField,
} from "./mapping";
import { buildRow } from "./transform";

const NOW = new Date("2026-10-05");

describe("cleanValue", () => {
  it("normalises NBSP, mojibake and runs of whitespace", () => {
    expect(cleanValue("252\u00a0PS")).toBe("252 PS");
    expect(cleanValue("252Â\u00a0PS")).toBe("252 PS");
    expect(cleanValue("  A6   Avant \t")).toBe("A6 Avant");
    expect(cleanValue(null)).toBe("");
  });
});

describe("parseYearCell", () => {
  it.each([
    ["2016", 2016],
    ["08/24", 2024],
    ["11/98", 1998],
    ["01/28", 2028],
    ["02/2005", 2005],
    ["15-08-2024", 2024],
    ["15.08.2024", 2024],
  ])("%s → %i", (cell, year) => {
    expect(parseYearCell(cell, NOW)).toEqual({ kind: "year", year });
  });

  it("treats '/', '-' and empty as no bound, and rejects nonsense", () => {
    expect(parseYearCell("/", NOW)).toEqual({ kind: "open" });
    expect(parseYearCell("", NOW)).toEqual({ kind: "open" });
    expect(parseYearCell("13/24", NOW)).toEqual({ kind: "invalid" });
    expect(parseYearCell("Facelift", NOW)).toEqual({ kind: "invalid" });
    expect(parseYearCell("1850", NOW)).toEqual({ kind: "invalid" });
  });
});

describe("year ranges", () => {
  it("from/to cells: open end, only an end year, reversed", () => {
    expect(yearsFromCells("02/05", "12/08", NOW)).toEqual({
      ok: true,
      from: 2005,
      to: 2008,
    });
    expect(yearsFromCells("08/24", "/", NOW)).toEqual({
      ok: true,
      from: 2024,
      to: null,
    });
    expect(yearsFromCells("", "2011", NOW)).toEqual({
      ok: true,
      from: 2011,
      to: 2011,
    });
    expect(yearsFromCells("2011", "2008", NOW)).toEqual({ ok: false });
    expect(yearsFromCells("", "", NOW)).toEqual({
      ok: true,
      from: null,
      to: null,
    });
  });

  it.each([
    ["2008-2011", 2008, 2011],
    ["2008 – 2011", 2008, 2011],
    ["2016-", 2016, null],
    ["2016", 2016, 2016],
    ["08/24 - /", 2024, null],
    ["15-08-2008 - 31-12-2011", 2008, 2011],
  ])("range cell %j", (cell, from, to) => {
    expect(parseYearRangeCell(cell, NOW)).toEqual({ ok: true, from, to });
  });

  it("rejects bad range cells", () => {
    expect(parseYearRangeCell("2011-2008", NOW)).toEqual({ ok: false });
    expect(parseYearRangeCell("abc-def", NOW)).toEqual({ ok: false });
    expect(parseYearRangeCell("-2011", NOW)).toEqual({ ok: false });
  });
});

const FIELDS: MapField[] = [
  { id: "make", label: "Make", type: "list", required: true },
  { id: "year", label: "Year", type: "year_range", required: true },
  { id: "model", label: "Model", type: "list", required: false },
];

describe("column mapping", () => {
  it("normalises headers", () => {
    expect(normalizeHeader("\ufeffPart_No.")).toBe("part no");
  });

  it("guesses from the saved mapping first, then header names", () => {
    const choices = guessChoices(
      ["Hersteller", "Year from", "Year to", "Model", "SKU", "Notes"],
      FIELDS,
      [{ columnName: "Hersteller", target: "field:make" }],
    );
    expect(choices).toEqual([
      "make",
      "year",
      "year",
      "model",
      ATTACHMENT,
      SKIP,
    ]);
  });

  it("ignores saved targets for fields that no longer exist", () => {
    expect(targetToChoice("field:gone", FIELDS)).toBeNull();
    expect(targetToChoice("field:year:from", FIELDS)).toBe("year");
  });

  it("a choice used one time too many resets the oldest column", () => {
    let s = { choices: [SKIP, SKIP, SKIP], order: [] as number[] };
    s = pickColumn(s.choices, s.order, 0, "make", FIELDS);
    s = pickColumn(s.choices, s.order, 2, "make", FIELDS);
    expect(s.choices).toEqual([SKIP, SKIP, "make"]);

    s = pickColumn(s.choices, s.order, 0, "year", FIELDS);
    s = pickColumn(s.choices, s.order, 1, "year", FIELDS);
    expect(s.choices).toEqual(["year", "year", "make"]); // a Year range takes two
    s = pickColumn(s.choices, s.order, 2, "year", FIELDS);
    expect(s.choices).toEqual([SKIP, "year", "year"]);
  });

  it("resolves a Year range to one range column or from/to by position", () => {
    const one = resolveChoices(["year", ATTACHMENT], FIELDS);
    expect(one.map((t) => t && targetToString(t))).toEqual([
      "field:year:range",
      ATTACHMENT,
    ]);
    const two = resolveChoices(["make", "year", "year", ATTACHMENT], FIELDS);
    expect(two.map((t) => t && targetToString(t))).toEqual([
      "field:make",
      "field:year:from",
      "field:year:to",
      ATTACHMENT,
    ]);
  });

  it("needs an Attachment column", () => {
    expect(validateChoices(["make", SKIP])).toEqual({
      attachmentMissing: true,
    });
    expect(validateChoices(["make", ATTACHMENT])).toEqual({
      attachmentMissing: false,
    });
  });
});

describe("buildRow", () => {
  const targets = resolveChoices(
    ["make", "year", "year", "model", ATTACHMENT],
    FIELDS,
  );

  it("builds values, years and attachment", () => {
    expect(
      buildRow(
        ["AUDI", "02/05", "12/08", "A6\u00a0Avant", " 47-116573 "],
        targets,
        FIELDS,
        NOW,
      ),
    ).toEqual({
      values: { make: "AUDI", model: "A6 Avant" },
      yearFrom: 2005,
      yearTo: 2008,
      attachment: "47-116573",
      error: null,
      raw: null,
    });
  });

  it("leaves out empty optional values", () => {
    const r = buildRow(["AUDI", "2016", "", "", "X"], targets, FIELDS, NOW);
    expect(r.values).toEqual({ make: "AUDI" });
    expect([r.yearFrom, r.yearTo]).toEqual([2016, null]);
  });

  it.each([
    [["AUDI", "2016", "", "", ""], "Attachment is empty"],
    [["", "2016", "", "", "X"], "Make is empty"],
    [["AUDI", "", "", "", "X"], "Year is empty"],
    [
      ["AUDI", "2011", "2008", "", "X"],
      "Year isn't a valid year or year range",
    ],
  ])("%j → %s, keeping the raw cells", (cells, error) => {
    const r = buildRow(cells, targets, FIELDS, NOW);
    expect(r.error).toBe(error);
    expect(r.raw).toMatchObject({ Attachment: cells[4], Make: cells[0] });
  });
});
