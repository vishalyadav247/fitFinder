import { describe, expect, it } from "vitest";
import { DEFAULT_TABLE_PAGE_SIZE, tablePageSize } from "./table-paging";

describe("tablePageSize", () => {
  it("accepts the offered sizes", () => {
    expect(tablePageSize("10")).toBe(10);
    expect(tablePageSize("25")).toBe(25);
    expect(tablePageSize(50)).toBe(50);
  });

  it("falls back to the default for anything else", () => {
    for (const raw of [
      null,
      undefined,
      "",
      "0",
      "100",
      "1e9",
      "-10",
      "abc",
      "25.5",
    ]) {
      expect(tablePageSize(raw)).toBe(DEFAULT_TABLE_PAGE_SIZE);
    }
  });
});
