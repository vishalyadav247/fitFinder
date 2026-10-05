import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { openCsv, readPreview, sniffDelimiter } from "./csv-reader.server";

const stream = (data: Buffer | string) =>
  Readable.from([Buffer.isBuffer(data) ? data : Buffer.from(data)]);

async function all(data: Buffer | string) {
  const csv = await openCsv(stream(data));
  const rows = [];
  for await (const r of csv.records) rows.push(r);
  return { csv, rows };
}

describe("csv reader", () => {
  it("sniffs the delimiter from the first line, ignoring quoted parts", () => {
    expect(sniffDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(sniffDelimiter('"a;b",c,d')).toBe(",");
    expect(sniffDelimiter("a\tb\tc")).toBe("\t");
  });

  it("reads semicolon files with quotes, a BOM and line numbers", async () => {
    const { csv, rows } = await all(
      '﻿Make;Model;SKU\r\nAUDI;"A6; Avant";X1\r\n\r\nBMW;3;X2\r\n',
    );
    expect(csv.delimiter).toBe(";");
    expect(rows.map((r) => r.cells)).toEqual([
      ["Make", "Model", "SKU"],
      ["AUDI", "A6; Avant", "X1"],
      ["BMW", "3", "X2"],
    ]);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4]);
  });

  it("reads gzip uploads", async () => {
    const { rows } = await all(gzipSync("a,b\n1,2\n"));
    expect(rows.map((r) => r.cells)).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("decodes Windows-1252 files", async () => {
    const latin1 = Buffer.from("Marke,Größe\nMÜLLER,Grün\n", "latin1");
    const { csv, rows } = await all(latin1);
    expect(csv.encoding).toBe("windows-1252");
    expect(rows[1].cells).toEqual(["MÜLLER", "Grün"]);
  });

  it("keeps UTF-8 files as UTF-8", async () => {
    const { csv, rows } = await all("Brand\nL’Oréal\n");
    expect(csv.encoding).toBe("utf-8");
    expect(rows[1].cells).toEqual(["L’Oréal"]);
  });

  it("tolerates rows with fewer or more cells", async () => {
    const { rows } = await all("a,b,c\n1,2\n1,2,3,4\n");
    expect(rows.map((r) => r.cells.length)).toEqual([3, 2, 4]);
  });

  it("previews the first row and the next 3 rows, then stops", async () => {
    const big =
      "h1,h2\n" + Array.from({ length: 10000 }, (_, i) => `${i},x`).join("\n");
    const p = await readPreview(stream(big));
    expect(p.firstRow).toEqual(["h1", "h2"]);
    expect(p.sampleRows).toEqual([
      ["0", "x"],
      ["1", "x"],
      ["2", "x"],
    ]);
  });
});

describe("unpacked size cap", () => {
  it("stops reading past maxBytes", async () => {
    const { CsvTooLargeError } = await import("./csv-reader.server");
    const csv = await openCsv(stream("a,b\n" + "1,2\n".repeat(50_000)), {
      maxBytes: 1000,
    });
    await expect(
      (async () => {
        for await (const r of csv.records) void r;
      })(),
    ).rejects.toBeInstanceOf(CsvTooLargeError);
  });
});
