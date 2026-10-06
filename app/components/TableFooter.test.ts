import { describe, expect, it } from "vitest";
import { pageRange } from "./TableFooter";

describe("pageRange", () => {
  it("shows nothing for an empty table", () => {
    expect(pageRange(0, 1, 50)).toEqual({
      pages: 1,
      current: 1,
      from: 0,
      to: 0,
    });
  });

  it("covers a full and a partial last page", () => {
    expect(pageRange(100, 2, 50)).toEqual({
      pages: 2,
      current: 2,
      from: 51,
      to: 100,
    });
    expect(pageRange(230, 3, 100)).toEqual({
      pages: 3,
      current: 3,
      from: 201,
      to: 230,
    });
  });

  it("clamps a page past the end to the last page", () => {
    expect(pageRange(60, 9, 25)).toEqual({
      pages: 3,
      current: 3,
      from: 51,
      to: 60,
    });
  });
});
