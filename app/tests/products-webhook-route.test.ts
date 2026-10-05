// products/* webhook route: queues the product for a background sync; ignores unknown shops (M6).
import { beforeEach, describe, expect, it, vi } from "vitest";

const webhook = vi.fn();
const getShopByDomain = vi.fn();
const queueProductSync = vi.fn<
  (shopId: string, productId: string) => Promise<void>
>(async () => undefined);

vi.mock("../db.server", () => ({ default: {} }));
vi.mock("../shopify.server", () => ({ authenticate: { webhook } }));
vi.mock("../models/shop.server", () => ({ getShopByDomain }));
vi.mock("../services/jobs.server", () => ({ queueProductSync }));

const { action } = await import("../routes/webhooks.products");

const deliver = (body: string) =>
  action({
    request: new Request("https://app.test/webhooks/products", {
      method: "POST",
      body,
    }),
    params: {},
    context: {},
  } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  getShopByDomain.mockResolvedValue({ id: "shop_1", uninstalledAt: null });
});

describe("products webhook", () => {
  it("queues an updated product by its gid", async () => {
    const payload = {
      admin_graphql_api_id: "gid://shopify/Product/7",
      title: "T",
    };
    webhook.mockResolvedValue({
      shop: "a.myshopify.com",
      topic: "PRODUCTS_UPDATE",
      payload,
    });
    const res = await deliver(JSON.stringify(payload));
    expect(res.status).toBe(200);
    expect(queueProductSync).toHaveBeenCalledWith(
      "shop_1",
      "gid://shopify/Product/7",
    );
  });

  it("queues a deleted product with an id above 2^53, digit for digit", async () => {
    const body = '{"id":788032119674292922}';
    webhook.mockResolvedValue({
      shop: "a.myshopify.com",
      topic: "PRODUCTS_DELETE",
      payload: JSON.parse(body),
    });
    await deliver(body);
    expect(queueProductSync).toHaveBeenCalledWith(
      "shop_1",
      "gid://shopify/Product/788032119674292922",
    );
  });

  it("ignores unknown and uninstalled shops and odd payloads", async () => {
    webhook.mockResolvedValue({
      shop: "a.myshopify.com",
      topic: "PRODUCTS_UPDATE",
      payload: { admin_graphql_api_id: "gid://shopify/Product/7" },
    });
    getShopByDomain.mockResolvedValueOnce(null);
    expect((await deliver("{}")).status).toBe(200);
    getShopByDomain.mockResolvedValueOnce({
      id: "s",
      uninstalledAt: new Date(),
    });
    expect((await deliver("{}")).status).toBe(200);
    webhook.mockResolvedValueOnce({
      shop: "a.myshopify.com",
      topic: "PRODUCTS_UPDATE",
      payload: { id: 1 },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await deliver("{}")).status).toBe(200);
    expect(queueProductSync).not.toHaveBeenCalled();
  });

  it("fails the delivery (Shopify retries) when the queue is down", async () => {
    webhook.mockResolvedValue({
      shop: "a.myshopify.com",
      topic: "PRODUCTS_UPDATE",
      payload: { admin_graphql_api_id: "gid://shopify/Product/7" },
    });
    queueProductSync.mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(deliver("{}")).rejects.toThrow("db down");
  });
});
