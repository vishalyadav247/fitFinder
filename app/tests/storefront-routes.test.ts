// Storefront page endpoints (M8): settings saves, theme status and icon upload validate their
// input, act for the session's shop, and report a failed theme publish without losing the save.
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveSettings = vi.fn();
const saveHeading = vi.fn();
const publish = vi.fn();
const readThemeStatus = vi.fn();
const uploadIcon = vi.fn();
const shopSearch = vi.fn();
const fieldOptions = vi.fn();
const previewResults = vi.fn();

vi.mock("../db.server", () => ({ default: {} }));
vi.mock("../shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => ({
      session: { shop: "demo.myshopify.com" },
      admin: { graphql: vi.fn() },
    })),
  },
}));
vi.mock("../models/shop.server", () => ({
  ensureShop: vi.fn(async () => ({ id: "shop_1" })),
}));
vi.mock("../models/storefront-settings.server", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("../models/storefront-settings.server")
    >();
  return { ...real, saveSettings, saveHeading };
});
vi.mock("../services/storefront/sync.server", () => ({
  publishWithOutcome: publish,
}));
vi.mock("../services/storefront/icon-upload.server", () => ({ uploadIcon }));
vi.mock("../services/storefront/query.server", () => ({
  shopSearch,
  fieldOptions,
}));
vi.mock("../services/storefront/preview.server", () => ({ previewResults }));
vi.mock("../services/storefront/themes.server", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("../services/storefront/themes.server")
    >();
  return { ...real, readThemeStatus };
});

const settingsRoute = await import("../routes/api.storefront-settings");
const themesRoute = await import("../routes/api.themes.$id");
const iconRoute = await import("../routes/api.storefront-icon");
const previewRoute = await import("../routes/api.storefront-preview");

async function put(body: unknown, method = "PUT") {
  const res = (await settingsRoute.action({
    request: new Request("https://app.test/api/storefront-settings", {
      method,
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    params: {},
    context: {},
  } as never)) as Response;
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  for (const m of [saveSettings, saveHeading, publish, readThemeStatus])
    m.mockReset();
});

describe("PUT /api/storefront-settings", () => {
  it("refuses bad bodies, unknown keys and invalid values with 400", async () => {
    for (const body of [
      "not json",
      { intent: "nope" },
      { intent: "setting", key: "resetText", value: '"Clear"' },
      { intent: "setting", key: "layout", value: '"grid"' },
      { intent: "setting", key: "btn", value: "red" },
      { intent: "setting", key: "button", value: '"   "' },
      { intent: "heading", value: "" },
    ]) {
      expect((await put(body)).status).toBe(400);
    }
    expect((await put({ intent: "publish" }, "POST")).status).toBe(405);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(saveHeading).not.toHaveBeenCalled();
  });

  it("saves one setting for the session's shop and publishes", async () => {
    const r = await put({ intent: "setting", key: "btn", value: '"#1d4ed8"' });
    expect(saveSettings).toHaveBeenCalledWith("shop_1", { btn: "#1D4ED8" });
    expect(publish).toHaveBeenCalledWith(expect.any(Function), "shop_1");
    expect(r).toEqual({ status: 200, body: { ok: true, published: true } });
  });

  it("saves the heading", async () => {
    await put({ intent: "heading", value: "  Find parts  " });
    expect(saveHeading).toHaveBeenCalledWith("shop_1", "Find parts");
  });

  it("keeps the save when the theme publish fails", async () => {
    publish.mockRejectedValue(new Error("Shopify down"));
    const r = await put({ intent: "setting", key: "labels", value: "true" });
    expect(r).toEqual({ status: 200, body: { ok: true, published: false } });
  });

  it("says the theme is behind when the publish couldn't finish", async () => {
    publish.mockResolvedValue("behind");
    const r = await put({ intent: "setting", key: "labels", value: "true" });
    expect(r.body).toEqual({ ok: true, published: false });
    publish.mockResolvedValue("pending");
    const p = await put({ intent: "setting", key: "labels", value: "true" });
    expect(p.body).toEqual({ ok: true, published: true });
  });

  it("reports a failed save as 500", async () => {
    saveSettings.mockRejectedValue(new Error("db down"));
    const r = await put({ intent: "setting", key: "labels", value: "true" });
    expect(r.status).toBe(500);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("GET /api/themes/:id", () => {
  const get = async (id: string) => {
    const res = (await themesRoute.loader({
      request: new Request(`https://app.test/api/themes/${id}`),
      params: { id },
      context: {},
    } as never)) as Response;
    return { status: res.status, body: await res.json() };
  };

  it("refuses ids that aren't numbers", async () => {
    expect((await get("gid://x")).status).toBe(400);
    expect(readThemeStatus).not.toHaveBeenCalled();
  });

  it("reads the theme for the session's shop", async () => {
    readThemeStatus.mockResolvedValue({
      embedOn: true,
      blocks: {},
      tableCodeFound: false,
    });
    const r = await get("123");
    expect(readThemeStatus).toHaveBeenCalledWith(
      expect.any(Function),
      "shop_1",
      "123",
    );
    expect(r.body.status.embedOn).toBe(true);
  });

  it("answers 502 when Shopify fails", async () => {
    readThemeStatus.mockRejectedValue(new Error("boom"));
    expect((await get("123")).status).toBe(502);
  });
});

describe("POST /api/storefront-icon", () => {
  const post = async (file?: Blob, name = "icon.png") => {
    const form = new FormData();
    if (file) form.append("file", file, name);
    // Encode the multipart body so the request carries a Content-Length, as browsers send it.
    const encoded = new Request("https://app.test/x", { method: "POST", body: form });
    const body = await encoded.arrayBuffer();
    const res = (await iconRoute.action({
      request: new Request("https://app.test/api/storefront-icon", {
        method: "POST",
        body,
        headers: {
          "content-type": encoded.headers.get("content-type")!,
          "content-length": String(body.byteLength),
        },
      }),
      params: {},
      context: {},
    } as never)) as Response;
    return { status: res.status, body: await res.json() };
  };

  it("refuses a missing file and files that aren't square SVG/PNG icons", async () => {
    expect((await post()).status).toBe(400);
    const gif = await post(new Blob(["GIF89a"]), "x.gif");
    expect(gif).toEqual({
      status: 400,
      body: { error: "Choose an SVG or PNG file." },
    });
    const wide = await post(
      new Blob(['<svg viewBox="0 0 100 20"></svg>']),
      "x.svg",
    );
    expect(wide.status).toBe(400);
    expect(saveSettings).not.toHaveBeenCalled();
  });
});

describe("POST /api/storefront-icon (limits and success)", () => {
  const call = async (
    body: BodyInit | null,
    headers: Record<string, string>,
  ) => {
    const res = (await iconRoute.action({
      request: new Request("https://app.test/api/storefront-icon", {
        method: "POST",
        body,
        headers,
      }),
      params: {},
      context: {},
    } as never)) as Response;
    return { status: res.status, body: await res.json() };
  };

  it("refuses bodies without a usable Content-Length, or too big", async () => {
    expect((await call("x", { "content-length": "abc" })).status).toBe(411);
    expect((await call("x", { "content-length": "999999" })).status).toBe(413);
    expect(uploadIcon).not.toHaveBeenCalled();
  });

  it("uploads, saves the icon for the session's shop and publishes", async () => {
    uploadIcon.mockResolvedValue("https://cdn.shopify.com/icon.svg");
    const form = new FormData();
    form.append("file", new Blob(['<svg viewBox="0 0 24 24"></svg>']), "i.svg");
    const req = new Request("https://app.test/x", {
      method: "POST",
      body: form,
    });
    const buf = await req.arrayBuffer();
    const r = await call(buf, {
      "content-type": req.headers.get("content-type")!,
      "content-length": String(buf.byteLength),
    });
    expect(r).toEqual({
      status: 200,
      body: { url: "https://cdn.shopify.com/icon.svg", published: true },
    });
    expect(saveSettings).toHaveBeenCalledWith("shop_1", {
      savedIcon: "custom",
      savedIconUrl: "https://cdn.shopify.com/icon.svg",
    });
    expect(publish).toHaveBeenCalled();
  });
});

describe("GET /api/storefront-preview", () => {
  const get = async (query: string) => {
    const res = (await previewRoute.loader({
      request: new Request(`https://app.test/api/storefront-preview?${query}`),
      params: {},
      context: {},
    } as never)) as Response;
    return { status: res.status, body: await res.json() };
  };
  const search = {
    shopId: "shop_1",
    dataVersion: 1,
    fields: [{ id: "make", type: "list", required: true, label: "Make" }],
  };

  it("answers 404 for a shop without a setup and 400 for bad requests", async () => {
    shopSearch.mockResolvedValue(null);
    expect((await get("path=options&field=make")).status).toBe(404);
    expect(shopSearch).toHaveBeenCalledWith("demo.myshopify.com");
    shopSearch.mockResolvedValue(search);
    expect((await get("path=fits")).status).toBe(400);
    expect((await get("path=options&field=nope")).status).toBe(400);
    expect(
      (await get("path=options&field=make&make=" + "x".repeat(201))).status,
    ).toBe(400);
  });

  it("serves options and results of the session's shop", async () => {
    shopSearch.mockResolvedValue(search);
    fieldOptions.mockResolvedValue(["AUDI"]);
    expect((await get("path=options&field=make")).body).toEqual({
      options: ["AUDI"],
    });
    expect((await get("path=results")).body).toEqual({ titles: [], total: 0 });
    expect(previewResults).not.toHaveBeenCalled();
    previewResults.mockResolvedValue({ titles: ["Brake pad"], total: 1 });
    expect((await get("path=results&make=AUDI")).body).toEqual({
      titles: ["Brake pad"],
      total: 1,
    });
  });
});
