import { describe, expect, it, vi } from "vitest";

const recorded: unknown[] = [];
vi.mock("./logs.server", () => ({
  recordLog: (entry: unknown) => recorded.push(entry),
}));
const { requestShop, routePath, slowEntry, SLOW_MS, timeRequests } =
  await import("./slow.server");

const token = (dest: string) =>
  [
    Buffer.from('{"alg":"HS256"}').toString("base64url"),
    Buffer.from(JSON.stringify({ dest })).toString("base64url"),
    "sig",
  ].join(".");

describe("slow requests", () => {
  it("names the route of data requests", () => {
    expect(routePath("/app/filter-data.data")).toBe("/app/filter-data");
    expect(routePath("/_root.data")).toBe("/");
    expect(routePath("/proxy/search")).toBe("/proxy/search");
  });

  it("finds the shop from the shop parameter, webhook header or session token", () => {
    expect(
      requestShop(new Request("https://a.test/app?shop=p.myshopify.com")),
    ).toBe("p.myshopify.com");
    expect(
      requestShop(
        new Request("https://a.test/webhooks/products", {
          headers: { "X-Shopify-Shop-Domain": "w.myshopify.com" },
        }),
      ),
    ).toBe("w.myshopify.com");
    expect(
      requestShop(
        new Request("https://a.test/api/fitment", {
          headers: {
            Authorization: `Bearer ${token("https://t.myshopify.com")}`,
          },
        }),
      ),
    ).toBe("t.myshopify.com");
    expect(
      requestShop(new Request("https://a.test/app?shop=evil.example.com")),
    ).toBeNull();
    expect(
      requestShop(
        new Request("https://a.test/x", {
          headers: { Authorization: "Bearer not-a-token" },
        }),
      ),
    ).toBeNull();
  });

  it("logs only requests over the threshold, grouped by method and path", () => {
    const req = new Request(
      "https://a.test/app/filter-data.data?shop=p.myshopify.com",
    );
    expect(slowEntry(req, 200, SLOW_MS - 1)).toBeNull();
    const slow = slowEntry(req, 200, SLOW_MS + 1500)!;
    expect(slow).toMatchObject({
      level: "slow",
      source: "request",
      message: "Slow request: GET /app/filter-data",
      path: "/app/filter-data",
      shopDomain: "p.myshopify.com",
      durationMs: SLOW_MS + 1500,
    });
    expect(slowEntry(req, 200, SLOW_MS + 9000)!.fingerprint).toBe(
      slow.fingerprint,
    );
    // A refused request names no shop (the shop parameter wasn't checked).
    expect(slowEntry(req, 401, SLOW_MS + 1)!.shopDomain).toBeNull();
    expect(slowEntry(req, 302, SLOW_MS + 1)!.shopDomain).toBeNull();
    // Nor does a public page, whatever its shop parameter says.
    expect(
      slowEntry(
        new Request("https://a.test/?shop=victim.myshopify.com"),
        200,
        SLOW_MS + 1,
      )!.shopDomain,
    ).toBeNull();
    // Only the path is kept: no query string (signatures, ids).
    expect(
      slowEntry(
        new Request(
          "https://a.test/proxy/search?signature=abc&logged_in_customer_id=7",
        ),
        200,
        SLOW_MS + 1,
      ),
    ).toMatchObject({
      path: "/proxy/search",
      message: "Slow request: GET /proxy/search",
    });
    // Big uploads and downloads are slow because of their size.
    expect(
      slowEntry(new Request("https://a.test/api/uploads?k=1"), 200, 60_000),
    ).toBeNull();
    expect(
      slowEntry(new Request("https://a.test/api/fitment/export"), 200, 60_000),
    ).toBeNull();
  });

  it("the middleware times the request and passes the response through", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    try {
      recorded.length = 0;
      const response = new Response("ok");
      const fast = await timeRequests(
        { request: new Request("https://a.test/app") } as never,
        async () => response,
      );
      expect(fast).toBe(response);
      expect(recorded).toHaveLength(0);
      await timeRequests(
        { request: new Request("https://a.test/proxy/search") } as never,
        async () => {
          vi.advanceTimersByTime(SLOW_MS + 10);
          return new Response(null, { status: 200 });
        },
      );
      expect(recorded).toEqual([
        expect.objectContaining({ message: "Slow request: GET /proxy/search" }),
      ]);
      // Bots wait for the whole page: not counted.
      await timeRequests(
        {
          request: new Request("https://a.test/", {
            headers: {
              "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)",
            },
          }),
        } as never,
        async () => {
          vi.advanceTimersByTime(SLOW_MS + 10);
          return new Response(null);
        },
      );
      expect(recorded).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
