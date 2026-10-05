// Product mapping route action: validation, Shopify lookups before linking, toasts (M6).
import { beforeEach, describe, expect, it, vi } from "vitest";

const graphql = vi.fn();
const linkManually = vi.fn();
const addUniversal = vi.fn();
const removeUniversal = vi.fn();
const productTitle = vi.fn(async () => "Brake kit");
const upsertProducts = vi.fn();
const upsertCollections = vi.fn();
const fetchProduct = vi.fn();
const fetchResources = vi.fn();
const requestLinkCheck = vi.fn(async () => true);
const linkCheckState = vi.fn(async () => ({ attempt: 3 }));

vi.mock("../db.server", () => ({ default: {} }));
vi.mock("../shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => ({
      session: { shop: "demo.myshopify.com" },
      admin: { graphql },
    })),
  },
}));
vi.mock("../models/shop.server", () => ({
  ensureShop: vi.fn(async () => ({ id: "shop_1" })),
}));
vi.mock("../services/jobs.server", () => ({ requestLinkCheck }));
vi.mock("../services/linking/link-runs.server", () => ({ linkCheckState }));
vi.mock("../services/linking/catalog.server", () => ({
  fetchProduct,
  fetchResources,
  upsertProducts,
  upsertCollections,
}));
vi.mock("../models/product-link.server", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../models/product-link.server")>();
  return {
    ...real,
    linkManually,
    addUniversal,
    removeUniversal,
    productTitle,
  };
});

const { action } = await import("../routes/app.product-mapping");
const { LinkRuleError } = await import("../models/product-link.server");

type Result = {
  data: { ok: boolean; toast?: string; error?: string; attempt?: number };
  init?: { status?: number };
};

async function post(body: Record<string, string>) {
  const request = new Request("https://app.test/app/product-mapping", {
    method: "POST",
    body: new URLSearchParams(body),
  });
  return (await action({
    request,
    params: {},
    context: {},
  } as never)) as unknown as Result;
}

const pads = {
  productId: "gid://shopify/Product/1",
  title: "Pads",
  handle: "pads",
  status: "ACTIVE",
  variants: [{ variantId: "gid://shopify/ProductVariant/7", sku: "P-1" }],
};

beforeEach(() => vi.clearAllMocks());

describe("product mapping action", () => {
  it("refuses bad input with 400 and touches nothing", async () => {
    for (const body of <Record<string, string>[]>[
      { intent: "nope" },
      {
        intent: "link",
        attachment: "A",
        resourceId: "gid://shopify/Customer/1",
      },
      { intent: "link", attachment: "", resourceId: "gid://shopify/Product/1" },
      { intent: "universal-add", ids: "not json" },
      {
        intent: "universal-add",
        ids: JSON.stringify(["gid://shopify/Order/1"]),
      },
      { intent: "universal-remove", productId: "1" },
    ]) {
      const r = await post(body);
      expect(r.init?.status).toBe(400);
    }
    expect(linkManually).not.toHaveBeenCalled();
    expect(addUniversal).not.toHaveBeenCalled();
  });

  it("queues a full link check and returns the run to wait for", async () => {
    const r = await post({ intent: "check" });
    expect(requestLinkCheck).toHaveBeenCalledWith("shop_1", { fullSync: true });
    expect(r.data).toEqual({ ok: true, attempt: 3 });
  });

  it("links to the product as read from Shopify, keeping a picked variant of it", async () => {
    fetchProduct.mockResolvedValue(pads);
    const r = await post({
      intent: "link",
      attachment: "P-1",
      resourceId: pads.productId,
      variantId: "gid://shopify/ProductVariant/7",
    });
    expect(fetchProduct).toHaveBeenCalledWith(graphql, pads.productId);
    expect(upsertProducts).toHaveBeenCalledWith("shop_1", [pads], {
      replaceVariants: true,
    });
    expect(linkManually).toHaveBeenCalledWith("shop_1", "P-1", {
      type: "product",
      productId: pads.productId,
      variantId: "gid://shopify/ProductVariant/7",
    });
    expect(r.data.toast).toBe("P-1 linked to a product");

    // A variant of another product is dropped.
    await post({
      intent: "link",
      attachment: "P-1",
      resourceId: pads.productId,
      variantId: "gid://shopify/ProductVariant/999",
    });
    expect(linkManually.mock.lastCall?.[2]).toMatchObject({ variantId: null });
  });

  it("says so when the product no longer exists", async () => {
    fetchProduct.mockResolvedValue(null);
    const r = await post({
      intent: "link",
      attachment: "P-1",
      resourceId: pads.productId,
    });
    expect(r.init?.status).toBe(409);
    expect(r.data.error).toBe("That product no longer exists.");
    expect(linkManually).not.toHaveBeenCalled();
  });

  it("links collection attachments to a collection", async () => {
    fetchResources.mockResolvedValue({
      products: [],
      collections: [
        {
          collectionId: "gid://shopify/Collection/5",
          handle: "a4",
          title: "A4",
        },
      ],
    });
    const r = await post({
      intent: "link",
      attachment: "/collections/a4",
      resourceId: "gid://shopify/Collection/5",
    });
    expect(linkManually).toHaveBeenCalledWith("shop_1", "/collections/a4", {
      type: "collection",
      collectionId: "gid://shopify/Collection/5",
    });
    expect(r.data.toast).toBe("/collections/a4 linked to a collection");
  });

  it("adds, marks and removes universal products with toasts", async () => {
    fetchResources.mockResolvedValue({ products: [pads], collections: [] });
    addUniversal.mockResolvedValue(1);
    let r = await post({
      intent: "universal-add",
      ids: JSON.stringify([pads.productId, pads.productId]),
    });
    expect(fetchResources).toHaveBeenCalledWith(graphql, [pads.productId]);
    expect(r.data.toast).toBe("Pads is now universal");

    r = await post({ intent: "universal-mark", productId: pads.productId });
    expect(r.data.toast).toBe("Brake kit is now universal");
    addUniversal.mockResolvedValue(0);
    r = await post({ intent: "universal-mark", productId: pads.productId });
    expect(r.init?.status).toBe(409);

    r = await post({ intent: "universal-remove", productId: pads.productId });
    expect(removeUniversal).toHaveBeenCalledWith("shop_1", pads.productId);
    expect(r.data.toast).toBe("Brake kit is no longer universal");
  });

  it("turns rule errors into 409 and other errors into 500", async () => {
    fetchProduct.mockResolvedValue(pads);
    linkManually.mockRejectedValueOnce(new LinkRuleError("No rows."));
    let r = await post({
      intent: "link",
      attachment: "A",
      resourceId: pads.productId,
    });
    expect(r.init?.status).toBe(409);
    linkManually.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    r = await post({
      intent: "link",
      attachment: "A",
      resourceId: pads.productId,
    });
    expect(r.init?.status).toBe(500);
  });
});
