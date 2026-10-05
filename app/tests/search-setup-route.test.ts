import { beforeEach, describe, expect, it, vi } from "vitest";

const applyFieldIntent = vi.fn();

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
  return { ...real, applyFieldIntent, listFields: vi.fn(async () => []) };
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

  it("returns the spec toasts for add and delete", async () => {
    expect((await post({ intent: "add" })).data.toast).toBe(
      "Field added. Map a column to it on your next import.",
    );
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
