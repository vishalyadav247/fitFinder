import { describe, expect, it } from "vitest";
import { buildRow } from "../import/transform";
import { parseYearRangeCell } from "../import/clean";
import {
  ATTACHMENT_KEY,
  cellDisplay,
  csvCell,
  exportHeader,
  exportLine,
  parseRowForm,
  rowSummary,
  yearsDisplay,
  yearsText,
  type RowField,
  type RowView,
} from "./rows";

const NOW = new Date("2026-10-05");
const FIELDS: RowField[] = [
  { id: "make", label: "Make", type: "list", required: true },
  { id: "year", label: "Year", type: "year_range", required: true },
  { id: "model", label: "Model", type: "list", required: false },
];

const row = (over: Partial<RowView> = {}): RowView => ({
  id: "1",
  values: { make: "Audi", model: "A4" },
  yearFrom: 2008,
  yearTo: 2011,
  attachment: "SKU-1",
  linked: false,
  ...over,
});

describe("years", () => {
  it("writes ranges the import reads back the same", () => {
    for (const [from, to] of [
      [2008, 2011],
      [2016, null],
      [2016, 2016],
    ] as const) {
      const text = yearsText(from, to);
      const back = parseYearRangeCell(text, NOW);
      expect(back).toEqual({ ok: true, from, to });
    }
    expect(yearsText(null, null)).toBe("");
  });

  it("shows ranges like the prototype", () => {
    expect(yearsDisplay(2008, 2011)).toBe("2008 – 2011");
    expect(yearsDisplay(2016, null)).toBe("2016 – now");
    expect(yearsDisplay(2016, 2016)).toBe("2016");
    expect(yearsDisplay(null, null)).toBe("—");
  });

  it("shows empty values as a dash and summarises a row", () => {
    expect(cellDisplay(FIELDS[2], row({ values: { make: "Audi" } }))).toBe("—");
    expect(rowSummary(FIELDS, row())).toBe(
      "SKU SKU-1 (Audi · 2008 – 2011 · A4)",
    );
  });
});

describe("parseRowForm", () => {
  it("cleans values and reads the year range", () => {
    const r = parseRowForm(
      {
        make: "  Audi  ",
        year: "2019-",
        model: "",
        [ATTACHMENT_KEY]: " SKU 1 ",
      },
      FIELDS,
      NOW,
    );
    expect(r).toEqual({
      ok: true,
      row: {
        values: { make: "Audi" },
        yearFrom: 2019,
        yearTo: null,
        attachment: "SKU 1",
      },
    });
  });

  it("asks for the SKU, required fields and a valid range", () => {
    const r = parseRowForm(
      { make: "", year: "2020-2010", [ATTACHMENT_KEY]: "" },
      FIELDS,
      NOW,
    );
    expect(r).toEqual({
      ok: false,
      fieldErrors: {
        make: "Enter Make",
        year: "Enter a year or a range like 2015-2020 or 2019-",
        [ATTACHMENT_KEY]: "Enter a SKU",
      },
    });
    const noYear = parseRowForm(
      { make: "Audi", year: "", [ATTACHMENT_KEY]: "x" },
      FIELDS,
      NOW,
    );
    expect(noYear.ok).toBe(false);
  });

  it("refuses values longer than the import keeps", () => {
    const r = parseRowForm(
      { make: "x".repeat(256), year: "2010", [ATTACHMENT_KEY]: "y" },
      FIELDS,
      NOW,
    );
    expect(r.ok).toBe(false);
  });
});

describe("export CSV", () => {
  it("guards formulas and quotes like the import report", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("-12")).toBe("'-12");
    expect(csvCell("AUDI")).toBe("AUDI");
  });

  it("uses the import columns: field labels, one year column, Attachment", () => {
    expect(exportHeader(FIELDS)).toBe("Make,Year,Model,Attachment\r\n");
    expect(exportLine(FIELDS, row({ yearTo: null }))).toBe(
      "Audi,2008-,A4,SKU-1\r\n",
    );
  });

  it.each([
    row({
      values: { make: "=HYPERLINK()", model: 'A4 "Avant", 5d' },
      attachment: "-SKU+1",
      yearTo: null,
    }),
    // Values that already start with an apostrophe before a formula character.
    row({
      values: { make: "'=quoted", model: "''+x" },
      attachment: "'-SKU",
      yearTo: null,
    }),
  ])("imports an exported line back unchanged ($attachment)", (tricky) => {
    const line = exportLine(FIELDS, tricky).trimEnd();
    // Split the CSV line like a reader would (quoted cells may hold commas).
    const cells = [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)]
      .map((m) => m[1])
      .slice(0, 4)
      .map((c) => (c.startsWith('"') ? c.slice(1, -1).replace(/""/g, '"') : c));
    const back = buildRow(
      cells,
      [
        { kind: "list", fieldId: "make" },
        { kind: "range", fieldId: "year" },
        { kind: "list", fieldId: "model" },
        { kind: "attachment" },
      ],
      FIELDS,
      NOW,
    );
    expect(back).toEqual({
      values: tricky.values,
      yearFrom: 2008,
      yearTo: null,
      attachment: tricky.attachment,
      error: null,
      raw: null,
    });
  });
});
