import { beforeEach, describe, expect, it, vi } from "vitest";

const saveRow = vi.fn();
const deleteRows = vi.fn();
const deleteAllRows = vi.fn();
const countDuplicates = vi.fn();
const removeDuplicates = vi.fn();
const relink = vi.fn<(shopId: string, o: unknown) => Promise<number>>(
  async () => 0,
);

vi.mock("../db.server", () => ({ default: {} }));
vi.mock("../shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => ({ session: { shop: "demo.myshopify.com" } })),
  },
}));
vi.mock("../services/linking/relink.server", () => ({
  relink,
  isLockTimeout: () => false,
}));
vi.mock("../models/shop.server", () => ({
  ensureShop: vi.fn(async () => ({ id: "shop_1" })),
}));
vi.mock("../models/fitment-row.server", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../models/fitment-row.server")>();
  return {
    ...real,
    saveRow,
    deleteRows,
    deleteAllRows,
    countDuplicates,
    removeDuplicates,
  };
});

const { action } = await import("../routes/app.filter-data");
const { FitmentRuleError, MAX_SELECTED } =
  await import("../models/fitment-row.server");

type Result = {
  data: {
    ok: boolean;
    toast?: string;
    error?: string;
    duplicates?: number;
    fieldErrors?: Record<string, string>;
  };
  init?: { status?: number };
};

async function post(body: Record<string, string>) {
  const request = new Request("https://app.test/app/filter-data", {
    method: "POST",
    body: new URLSearchParams(body),
  });
  return (await action({
    request,
    params: {},
    context: {},
  } as never)) as unknown as Result;
}

beforeEach(() => {
  for (const fn of [
    saveRow,
    deleteRows,
    deleteAllRows,
    countDuplicates,
    removeDuplicates,
  ]) {
    fn.mockReset();
  }
});

describe("filter data action", () => {
  it("rejects unknown intents and bad ids with 400", async () => {
    const tooMany = JSON.stringify(
      Array.from({ length: MAX_SELECTED + 1 }, (_, i) => String(i + 1)),
    );
    for (const body of <Record<string, string>[]>[
      { intent: "wipe" },
      { intent: "edit", rowId: "abc" },
      { intent: "delete", ids: "not json" },
      { intent: "delete", ids: "[]" },
      { intent: "delete", ids: '["1; DROP"]' },
      { intent: "delete", ids: tooMany },
    ]) {
      expect((await post(body)).init?.status).toBe(400);
    }
    expect(deleteRows).not.toHaveBeenCalled();
  });

  it("adds and edits rows for the session's shop with the spec toasts", async () => {
    saveRow.mockResolvedValue({ ok: true, attachment: "S" });
    const added = await post({ intent: "add", f1: "Audi", attachment: "S" });
    // The saved row is linked right away (Product mapping › Add filter row).
    expect(relink).toHaveBeenLastCalledWith("shop_1", {
      attachments: ["S"],
      lockTimeout: "3s",
    });
    expect(saveRow).toHaveBeenLastCalledWith(
      "shop_1",
      null,
      expect.objectContaining({ f1: "Audi", attachment: "S" }),
    );
    expect(added.data).toEqual({ ok: true, toast: "Row added" });
    saveRow.mockResolvedValue({ ok: true, attachment: "S", previous: "OLD" });
    const edited = await post({ intent: "edit", rowId: "42", attachment: "S" });
    // The old SKU is relinked too (its product may have no filter data any more).
    expect(relink.mock.lastCall?.[1]).toMatchObject({
      attachments: ["S", "OLD"],
    });
    expect(saveRow.mock.lastCall?.[1]).toBe(BigInt(42));
    expect(edited.data.toast).toBe("Row updated");
  });

  it("returns field errors with 400", async () => {
    saveRow.mockResolvedValue({
      ok: false,
      fieldErrors: { attachment: "Enter a SKU" },
    });
    const r = await post({ intent: "add" });
    expect(r.init?.status).toBe(400);
    expect(r.data.fieldErrors).toEqual({ attachment: "Enter a SKU" });
  });

  it("deletes with counted toasts", async () => {
    deleteRows.mockResolvedValue(1);
    // The row's own delete icon vs a one-row selection (prototype app.js:84-85).
    expect(
      (await post({ intent: "delete", ids: '["7"]', single: "1" })).data.toast,
    ).toBe("Row deleted");
    expect((await post({ intent: "delete", ids: '["7"]' })).data.toast).toBe(
      "1 row deleted",
    );
    expect(deleteRows).toHaveBeenLastCalledWith("shop_1", [BigInt(7)]);
    deleteRows.mockResolvedValue(3);
    expect(
      (await post({ intent: "delete", ids: '["1","2","3","3"]' })).data.toast,
    ).toBe("3 rows deleted");
    expect(deleteRows.mock.lastCall?.[1]).toHaveLength(3);
    deleteAllRows.mockResolvedValue(9);
    expect((await post({ intent: "delete-all" })).data.toast).toBe(
      "All filter rows deleted",
    );
  });

  it("counts and removes duplicates", async () => {
    countDuplicates.mockResolvedValue(4);
    expect((await post({ intent: "dedupe-count" })).data).toEqual({
      ok: true,
      duplicates: 4,
    });
    removeDuplicates.mockResolvedValue(1);
    expect((await post({ intent: "dedupe" })).data.toast).toBe(
      "1 duplicate row removed",
    );
  });

  it("shows rule errors as 409 and hides other errors behind a 500", async () => {
    deleteAllRows.mockRejectedValue(
      new FitmentRuleError("An import is running."),
    );
    const rule = await post({ intent: "delete-all" });
    expect(rule.init?.status).toBe(409);
    expect(rule.data.error).toBe("An import is running.");
    vi.spyOn(console, "error").mockImplementation(() => {});
    removeDuplicates.mockRejectedValue(new Error("db down"));
    const crash = await post({ intent: "dedupe" });
    expect(crash.init?.status).toBe(500);
    expect(crash.data.error).not.toContain("db down");
  });
});
