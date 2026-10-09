import { beforeEach, describe, expect, it, vi } from "vitest";

const applyFieldIntent = vi.fn();
const applyFieldSave = vi.fn();

vi.mock("../db.server", () => ({ default: {} }));
vi.mock("../shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => ({
      session: { shop: "demo.myshopify.com" },
      redirect: (url: string) =>
        new Response(null, { status: 302, headers: { Location: url } }),
    })),
  },
}));
vi.mock("../models/shop.server", () => ({
  ensureShop: vi.fn(async () => ({ id: "shop_1" })),
}));
vi.mock("../models/search-field.server", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../models/search-field.server")>();
  return {
    ...real,
    applyFieldIntent,
    applyFieldSave,
    listFields: vi.fn(async () => []),
  };
});

const { action } = await import("../routes/app.search-setup");
const { FieldRuleError } = await import("../models/search-field.server");

type Result = {
  data: { ok: boolean; toast?: string; error?: string };
  init?: { status?: number };
};

async function post(body: Record<string, string | undefined>) {
  const request = new Request("https://app.test/app/search-setup", {
    method: "POST",
    body: new URLSearchParams(body as Record<string, string>),
  });
  return (await action({
    request,
    params: {},
    context: {},
  } as never)) as unknown as Result;
}

beforeEach(() => {
  applyFieldIntent.mockReset();
  applyFieldSave.mockReset();
});

describe("search setup action", () => {
  it("rejects unknown intents and bad values with 400", async () => {
    for (const body of [
      { intent: "rename-all" },
      { intent: "type", fieldId: "f1", value: "years" },
      { intent: "required", fieldId: "f1", value: "yes" },
      { intent: "label", fieldId: "f1", value: "x".repeat(61) },
    ]) {
      const r = await post(body);
      expect(r.init?.status).toBe(400);
    }
    expect(applyFieldIntent).not.toHaveBeenCalled();
  });

  it("applies the change for the session's shop", async () => {
    const r = await post({ intent: "required", fieldId: "f1", value: "false" });
    expect(applyFieldIntent).toHaveBeenCalledWith("shop_1", {
      intent: "required",
      fieldId: "f1",
      value: false,
    });
    expect(r.data).toEqual({ ok: true, toast: undefined });
  });

  const save = (changes: unknown) =>
    post({
      intent: "save",
      changes: typeof changes === "string" ? changes : JSON.stringify(changes),
    });

  it("turns the save bar's draft into one ordered save", async () => {
    const r = await save({
      edits: [
        { fieldId: "f1", label: "Brand", required: false },
        { fieldId: "f2", type: "list" },
      ],
      added: [
        {
          key: "new:1",
          label: "Engine",
          placeholder: "",
          type: "year_range",
          required: true,
        },
      ],
      order: ["f2", "new:1", "f1"],
    });
    expect(applyFieldSave).toHaveBeenCalledTimes(1);
    expect(applyFieldSave.mock.calls[0][0]).toBe("shop_1");
    // New fields first, then names/placeholders/required, then Dropdown before Year range, then
    // the order (so the one Year range can move from f2 to the new field).
    expect(applyFieldSave.mock.calls[0][1]).toEqual([
      { intent: "add", key: "new:1" },
      { intent: "label", fieldId: "f1", value: "Brand" },
      { intent: "required", fieldId: "f1", value: false },
      { intent: "label", fieldId: "new:1", value: "Engine" },
      { intent: "placeholder", fieldId: "new:1", value: "" },
      { intent: "required", fieldId: "new:1", value: true },
      { intent: "type", fieldId: "f2", value: "list" },
      { intent: "type", fieldId: "new:1", value: "year_range" },
      { intent: "order", fieldIds: ["f2", "new:1", "f1"] },
    ]);
    expect(applyFieldIntent).not.toHaveBeenCalled();
    expect(r.data).toEqual({
      ok: true,
      toast: "Fields saved. Map a column to the new field on your next import.",
    });
  });

  it("says just Fields saved without new fields", async () => {
    const r = await save({
      edits: [{ fieldId: "f1", label: "Brand" }],
      added: [],
    });
    expect(r.data).toEqual({ ok: true, toast: "Fields saved" });
  });

  it("refuses bad save bodies and reports a refused save", async () => {
    for (const changes of [
      "not json",
      [{ fieldId: "f1", label: "x" }],
      { edits: [{ fieldId: "f1", type: "years" }], added: [] },
      { edits: [{ label: "No id" }], added: [] },
      { edits: [], added: [{ key: "f9", label: "Not a new key" }] },
    ]) {
      expect((await save(changes)).init?.status).toBe(400);
    }
    expect(applyFieldSave).not.toHaveBeenCalled();
    applyFieldSave.mockRejectedValueOnce(
      new FieldRuleError("Only one field can be a year range."),
    );
    const r = await save({
      edits: [{ fieldId: "f1", type: "year_range" }],
      added: [],
    });
    expect(r.init?.status).toBe(409);
    expect(r.data.error).toBe("Only one field can be a year range.");
  });

  it("returns the spec toast for delete", async () => {
    expect((await post({ intent: "delete", fieldId: "f1" })).data.toast).toBe(
      "Field deleted",
    );
  });

  it("returns rule errors as 409 with the message for the toast", async () => {
    applyFieldIntent.mockRejectedValue(
      new FieldRuleError("Only one field can be a year range."),
    );
    const r = await post({
      intent: "type",
      fieldId: "f1",
      value: "year_range",
    });
    expect(r.init?.status).toBe(409);
    expect(r.data).toEqual({
      ok: false,
      error: "Only one field can be a year range.",
    });
  });

  it("logs and returns 500 on unexpected errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    applyFieldIntent.mockRejectedValue(new Error("db down"));
    const r = await post({ intent: "add" });
    expect(r.init?.status).toBe(500);
    expect(log).toHaveBeenCalled();
  });
});
