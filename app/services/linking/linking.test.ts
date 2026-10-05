// Pure linking rules: attachment classification, bulk JSONL → catalog, webhook payloads, bulk
// polling (M6).
import { describe, expect, it, vi } from "vitest";
import {
  classifyAttachment,
  gidType,
  kindLabel,
  productLinkAttachment,
} from "./attachment";
import {
  collectBulkLines,
  deletedProductId,
  fetchResources,
  productIdFromWebhook,
  startBulkExport,
  waitForBulk,
  type AdminGraphql,
} from "./catalog.server";

// Whitespace a CSV cell can carry at its edges (tab, no-break space).
const TAB = String.fromCharCode(9);
const NBSP = String.fromCharCode(160);

describe("classifyAttachment", () => {
  it.each([
    ["BRK-123", { kind: "sku", key: "brk-123" }],
    ["  Brk-123 ", { kind: "sku", key: "brk-123" }],
    [`${TAB}Brk-123${NBSP}`, { kind: "sku", key: "brk-123" }],
    // Bare text is a SKU first (and a product handle when no SKU matches).
    ["brake-pads", { kind: "sku", key: "brake-pads" }],
    [
      "https://shop.example/products/Brake-Pads?variant=1",
      { kind: "product", key: "brake-pads" },
    ],
    ["/products/brake-pads", { kind: "product", key: "brake-pads" }],
    ["HTTPS://SHOP.EXAMPLE/PRODUCTS/PADS", { kind: "product", key: "pads" }],
    [
      "https://shop.example/collections/audi-a4",
      { kind: "collection", key: "audi-a4" },
    ],
    [
      "/collections/audi-a4/products/brake-pads",
      { kind: "product", key: "brake-pads" },
    ],
    ["/collections/audi#top", { kind: "collection", key: "audi" }],
  ] as const)("%s", (attachment, expected) => {
    expect(classifyAttachment(attachment)).toEqual(expected);
  });

  it("labels kinds like the prototype", () => {
    expect(kindLabel("sku")).toBe("SKU");
    expect(kindLabel("product")).toBe("Product link");
    expect(kindLabel("collection")).toBe("Collection link");
    expect(productLinkAttachment("pads")).toBe("/products/pads");
  });

  it("accepts only product, variant and collection gids", () => {
    expect(gidType("gid://shopify/Product/12")).toBe("Product");
    expect(gidType("gid://shopify/ProductVariant/3")).toBe("ProductVariant");
    expect(gidType("gid://shopify/Collection/9")).toBe("Collection");
    expect(gidType("gid://shopify/Customer/9")).toBeNull();
    expect(gidType("gid://shopify/Product/12 OR 1=1")).toBeNull();
  });
});

describe("collectBulkLines", () => {
  it("groups variants under their product, in any order", async () => {
    const lines = [
      JSON.stringify({
        id: "gid://shopify/ProductVariant/2",
        sku: "B",
        __parentId: "gid://shopify/Product/1",
      }),
      JSON.stringify({
        id: "gid://shopify/Product/1",
        title: "Pads",
        handle: "Pads",
        status: "ACTIVE",
      }),
      JSON.stringify({
        id: "gid://shopify/ProductVariant/3",
        sku: null,
        __parentId: "gid://shopify/Product/1",
      }),
      "",
      JSON.stringify({
        id: "gid://shopify/Product/4",
        title: "Disc",
        handle: "disc",
        status: "DRAFT",
      }),
      JSON.stringify({ id: "gid://shopify/Other/1" }),
    ];
    const products = await collectBulkLines(lines);
    expect(products).toEqual([
      {
        productId: "gid://shopify/Product/1",
        title: "Pads",
        handle: "pads",
        status: "ACTIVE",
        variants: [
          { variantId: "gid://shopify/ProductVariant/3", sku: "" },
          { variantId: "gid://shopify/ProductVariant/2", sku: "B" },
        ],
      },
      {
        productId: "gid://shopify/Product/4",
        title: "Disc",
        handle: "disc",
        status: "DRAFT",
        variants: [],
      },
    ]);
  });
});

describe("product webhooks", () => {
  it("reads the product id of products/create|update", () => {
    expect(
      productIdFromWebhook({
        admin_graphql_api_id: "gid://shopify/Product/7",
        title: "Shirt",
      }),
    ).toBe("gid://shopify/Product/7");
    expect(productIdFromWebhook({ id: 1 })).toBeNull();
    expect(
      productIdFromWebhook({ admin_graphql_api_id: "gid://shopify/Order/7" }),
    ).toBeNull();
  });

  it("reads products/delete ids digit for digit", () => {
    // Larger than Number.MAX_SAFE_INTEGER: read from the raw body.
    expect(deletedProductId('{"id":788032119674292922}')).toBe(
      "gid://shopify/Product/788032119674292922",
    );
    expect(deletedProductId('{"id":"x"}')).toBeNull();
  });
});

const gqlReturning = (...bodies: unknown[]) => {
  const fn = vi.fn(async () => ({ json: async () => bodies.shift() }));
  return fn as unknown as AdminGraphql & typeof fn;
};

describe("bulk export", () => {
  it("starts the export with the products query", async () => {
    const gql = gqlReturning({
      data: {
        bulkOperationRunQuery: {
          bulkOperation: { id: "gid://shopify/BulkOperation/1" },
          userErrors: [],
        },
      },
    });
    expect(await startBulkExport(gql)).toBe("gid://shopify/BulkOperation/1");
    const calls = gql.mock.calls as unknown as [
      string,
      { variables: { query: string } },
    ][];
    expect(calls[0][1].variables.query).toContain("variants");
  });

  it("reports user errors", async () => {
    const gql = gqlReturning({
      data: {
        bulkOperationRunQuery: {
          bulkOperation: null,
          userErrors: [{ message: "already running" }],
        },
      },
    });
    await expect(startBulkExport(gql)).rejects.toThrow("already running");
  });

  it("polls until completed", async () => {
    const gql = gqlReturning(
      {
        data: {
          bulkOperation: { status: "RUNNING", errorCode: null, url: null },
        },
      },
      {
        data: {
          bulkOperation: {
            status: "COMPLETED",
            errorCode: null,
            url: "https://x/file.jsonl",
          },
        },
      },
    );
    const onPoll = vi.fn(async () => {});
    const url = await waitForBulk(async () => gql, "id", onPoll, {
      pollMs: 1,
    });
    expect(url).toBe("https://x/file.jsonl");
    expect(onPoll).toHaveBeenCalledTimes(1);
  });

  it("fails on a failed operation or GraphQL errors", async () => {
    const failed = gqlReturning({
      data: {
        bulkOperation: { status: "FAILED", errorCode: "TIMEOUT", url: null },
      },
    });
    await expect(
      waitForBulk(async () => failed, "id", undefined, { pollMs: 1 }),
    ).rejects.toThrow("TIMEOUT");
    const errors = gqlReturning({ errors: [{ message: "Throttled" }] });
    await expect(
      waitForBulk(async () => errors, "id", undefined, { pollMs: 1 }),
    ).rejects.toThrow("Throttled");
  });
});

describe("Admin API calls", () => {
  it("retries throttled calls", async () => {
    const gql = gqlReturning(
      { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] },
      {
        data: {
          bulkOperationRunQuery: {
            bulkOperation: { id: "gid://shopify/BulkOperation/2" },
            userErrors: [],
          },
        },
      },
    );
    expect(await startBulkExport(gql)).toBe("gid://shopify/BulkOperation/2");
    expect(gql).toHaveBeenCalledTimes(2);
  });

  it("looks picked resources up in batches of 50, skipping unknown ids", async () => {
    const ids = Array.from(
      { length: 120 },
      (_, i) => `gid://shopify/Product/${i + 1}`,
    );
    const gql = vi.fn(
      async (_q: string, o?: { variables?: Record<string, unknown> }) => ({
        json: async () => ({
          data: {
            nodes: (o!.variables!.ids as string[]).map((id) =>
              id.endsWith("/7")
                ? null
                : {
                    id,
                    title: "T",
                    handle: "H",
                    status: "ACTIVE",
                    variants: { nodes: [] },
                  },
            ),
          },
        }),
      }),
    );
    const { products } = await fetchResources(
      gql as unknown as AdminGraphql,
      ids,
    );
    expect(gql).toHaveBeenCalledTimes(3);
    expect(products).toHaveLength(119);
    expect(products[0]).toMatchObject({ handle: "h" });
  });
});
