import { beforeEach, describe, expect, it, vi } from "vitest";

const listRows = vi.fn();

vi.mock("../db.server", () => ({ default: {} }));
vi.mock("../shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => ({ session: { shop: "demo.myshopify.com" } })),
  },
}));
vi.mock("../models/shop.server", () => ({
  ensureShop: vi.fn(async () => ({ id: "shop_1" })),
}));
vi.mock("../models/fitment-row.server", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../models/fitment-row.server")>();
  return { ...real, listRows };
});

const { loader } = await import("../routes/api.fitment");
const { action: exportAction } = await import("../routes/api.fitment.export");
const { FitmentRuleError } = await import("../models/fitment-row.server");

const get = (query: string) =>
  loader({
    request: new Request(`https://app.test/api/fitment?${query}`),
    params: {},
    context: {},
  } as never) as Promise<Response>;

beforeEach(() => {
  listRows.mockReset();
});

describe("GET /api/fitment", () => {
  it("rejects bad pages and long queries", async () => {
    for (const q of [
      "page=0",
      "page=abc",
      "page=1.5",
      `q=${"x".repeat(101)}`,
    ]) {
      expect((await get(q)).status).toBe(400);
    }
    expect(listRows).not.toHaveBeenCalled();
  });

  it("lists the session shop's rows", async () => {
    listRows.mockResolvedValue({
      rows: [],
      page: 2,
      hasNextPage: false,
      matching: 0,
    });
    const res = await get("q=audi&page=2");
    expect(res.status).toBe(200);
    expect(listRows).toHaveBeenCalledWith("shop_1", { q: "audi", page: 2 });
  });

  it("returns a slow search's message as 409", async () => {
    listRows.mockRejectedValue(
      new FitmentRuleError(
        "This search took too long. Try a longer or more exact search.",
      ),
    );
    const res = await get("q=a");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "This search took too long. Try a longer or more exact search.",
    });
  });
});

describe("POST /api/fitment/export", () => {
  const post = (body: unknown) =>
    exportAction({
      request: new Request("https://app.test/api/fitment/export", {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      params: {},
      context: {},
    } as never) as Promise<Response>;

  it("rejects bad scopes and ids before touching the database", async () => {
    for (const body of [
      "not json",
      { scope: "everything" },
      { scope: "selected" },
      { scope: "selected", ids: [] },
      { scope: "selected", ids: ["1 OR 1=1"] },
      {
        scope: "selected",
        ids: Array.from({ length: 5001 }, (_, i) => String(i + 1)),
      },
    ]) {
      expect((await post(body)).status).toBe(400);
    }
  });
});
