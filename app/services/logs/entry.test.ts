import { describe, expect, it } from "vitest";
import {
  entryFromConsole,
  fingerprint,
  ignored,
  MAX_DETAIL,
  MAX_MESSAGE,
  redact,
} from "./entry";

describe("redact", () => {
  it("removes tokens, secrets and email addresses", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJkZXN0IjoiaHR0cHM6Ly94Lm15c2hvcGlmeS5jb20ifQ.c2lnbmF0dXJl";
    const text = [
      "token shpat_abc123DEF and shprt_zzz9",
      `Authorization: Bearer ${jwt}`,
      `raw ${jwt}`,
      '{"password":"hunter2-long","accessToken":"abc","note":"ok"}',
      "?signature=deadbeef&hmac=cafe&shop=x.myshopify.com",
      "cookie=__sparefit_bo=abc.def",
      "mail jane.doe+shop@example.co.uk now",
    ].join("\n");
    const out = redact(text);
    for (const secret of [
      "shpat_abc123DEF",
      "shprt_zzz9",
      jwt,
      "hunter2-long",
      '"abc"',
      "deadbeef",
      "cafe",
      "__sparefit_bo=abc",
      "jane.doe",
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('"note":"ok"');
    expect(out).toContain("shop=x.myshopify.com");
    expect(out).toContain("[email]");
  });
});

describe("redact: what the app really logs", () => {
  it.each([
    ["prefixed secret keys", "client_secret=abc123&x=1", "abc123"],
    [
      "env-style names",
      "SHOPIFY_API_SECRET: supersecretvalue",
      "supersecretvalue",
    ],
    [
      "escaped JSON (a response body logged as text)",
      JSON.stringify(
        JSON.stringify({ client_secret: "x3", refresh_token: "y4" }),
      ),
      "x3",
    ],
    [
      "database URL credentials",
      "postgres://sparefit:hunter2@db:5432/sparefit",
      "hunter2",
    ],
    [
      "app proxy shopper id and OAuth params",
      "https://a.test/x?shop=s.myshopify.com&logged_in_customer_id=12345&code=abc9&hmac=ff",
      "12345",
    ],
    [
      "every cookie pair",
      "Cookie: a=1; __sparefit_bo=abc.def; other=zz9",
      "zz9",
    ],
    ["IP addresses", '{ ip: "203.0.113.7" } via 198.51.100.4', "198.51.100.4"],
    ["IPv6", "from 2001:db8:85a3::8a2e:370:7334", "8a2e:370:7334"],
    [
      "a Prisma error printing its arguments",
      'Invalid `prisma.session.update()` invocation: { accessToken: "tok-1", email: "a@b.co" }',
      "tok-1",
    ],
  ])("removes %s", (_name, text, secret) => {
    expect(redact(text)).not.toContain(secret);
  });

  it("keeps error codes and ordinary values readable", () => {
    const out = redact(
      'code: P2002\nmeta: {"target":["shop_id"]} shop=x.myshopify.com',
    );
    expect(out).toContain("code: P2002");
    expect(out).toContain("shop_id");
    expect(out).toContain("shop=x.myshopify.com");
    // The other cookie-less pairs and the app's own fields stay.
    expect(redact("app proxy path_prefix=/apps/sparefit")).toContain(
      "path_prefix=/apps/sparefit",
    );
  });
});

describe("entryFromConsole", () => {
  it("reads the area, message, shop and error of an app log call", () => {
    const error = new Error("Throttled");
    const e = entryFromConsole("error", [
      "storefront: icon upload failed",
      { shop: "parts.myshopify.com", error },
    ]);
    expect(e).toMatchObject({
      level: "error",
      source: "storefront",
      message: "storefront: icon upload failed",
      shopDomain: "parts.myshopify.com",
      path: null,
    });
    expect(e.detail).toContain("Error: Throttled");
    expect(e.detail).toContain("entry.test.ts"); // the stack
    expect(e.fingerprint).toMatch(/^[0-9a-f]{40}$/);
  });

  it("takes an Error as the message and keeps Prisma codes and causes", () => {
    const err = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["shop_id"] },
      cause: new Error("inner"),
    });
    const e = entryFromConsole("error", [err]);
    expect(e.message).toBe("Error: Unique constraint failed");
    expect(e.source).toBe("error");
    expect(e.detail).toContain("code: P2002");
    expect(e.detail).toContain("shop_id");
    expect(e.detail).toContain("cause: Error: inner");
  });

  it("falls back to 'app' without an area and reads path and duration", () => {
    const e = entryFromConsole("warn", [
      "pg-boss error",
      { path: "GET /app", durationMs: 1234.6, domain: "x.myshopify.com" },
    ]);
    expect(e).toMatchObject({
      level: "warn",
      source: "app",
      path: "GET /app",
      durationMs: 1235,
      shopDomain: "x.myshopify.com",
    });
  });

  it("ignores values that aren't shop domains and survives odd values", () => {
    const cyclic: Record<string, unknown> = { shop: "not a shop", n: 10n };
    cyclic.self = cyclic;
    const e = entryFromConsole("error", ["import: odd", cyclic, undefined]);
    expect(e.shopDomain).toBeNull();
    expect(e.detail).toContain("[circular]");
    expect(e.detail).toContain('"10"');
  });

  it("removes secrets from message and detail and cuts long texts", () => {
    const e = entryFromConsole("error", [
      `auth: failed for shpat_secret ${"x".repeat(1000)}`,
      { token: "shpat_other", body: "y".repeat(20_000) },
    ]);
    expect(e.message).not.toContain("shpat_secret");
    expect(e.message.length).toBeLessThanOrEqual(MAX_MESSAGE);
    expect(e.detail).not.toContain("shpat_other");
    expect(e.detail!.length).toBeLessThanOrEqual(MAX_DETAIL);
  });
});

describe("grouping of real log calls", () => {
  it("keeps different errors at the same log call apart", () => {
    const at = (error: Error, path = "GET /app/filter-data") =>
      entryFromConsole("error", ["route: unhandled error", { path, error }])
        .fingerprint;
    const typeError = at(new TypeError("x is undefined"));
    expect(typeError).toBe(at(new TypeError("x is undefined")));
    expect(typeError).not.toBe(at(new Error("Timed out after 110 s")));
    expect(typeError).not.toBe(
      at(new TypeError("x is undefined"), "POST /api/imports"),
    );
    // Only numbers differ: the same error.
    expect(at(new Error("job 12 failed"))).toBe(at(new Error("job 99 failed")));
  });

  it("names entries logged with the shop id, and keeps shops apart", () => {
    const a = entryFromConsole("error", [
      "billing: plan read failed",
      { shopId: "cshopa1" },
    ]);
    const b = entryFromConsole("error", [
      "billing: plan read failed",
      { shopId: "cshopb2" },
    ]);
    expect(a.shopId).toBe("cshopa1");
    expect(a.shopDomain).toBeNull();
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});

describe("fingerprint", () => {
  it("groups by level, source, message without numbers, and shop", () => {
    const base = {
      level: "error" as const,
      source: "import",
      message: "import: job 12 failed",
      shopDomain: "a.myshopify.com",
    };
    expect(fingerprint(base)).toBe(
      fingerprint({ ...base, message: "import: job 9876 failed" }),
    );
    expect(fingerprint(base)).not.toBe(
      fingerprint({ ...base, shopDomain: "b.myshopify.com" }),
    );
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, level: "warn" }));
  });
});

describe("ignored", () => {
  it("skips framework and dev-server notices", () => {
    expect(ignored(["⚠️  Future Flag Warning: Route middleware…"])).toBe(true);
    expect(ignored(["[vite] hmr update"])).toBe(true);
    // As vite really prints them: coloured and timestamped.
    expect(
      ignored([
        "\u001b[2m7:12:12 PM\u001b[22m \u001b[31m\u001b[1m[vite]\u001b[22m\u001b[39m \u001b[31mInternal server error",
      ]),
    ).toBe(true);
    expect(
      entryFromConsole("error", ["\u001b[31mimport: failed\u001b[39m"]).message,
    ).toBe("import: failed");
    // Terminal hyperlinks (OSC 8) too.
    expect(
      entryFromConsole("error", [
        "\u001b]8;;https://x.test\u0007import: link\u001b]8;;\u0007",
      ]).message,
    ).toBe("import: link");
    expect(ignored(["storefront: publish failed"])).toBe(false);
    expect(ignored([new Error("x")])).toBe(false);
  });
});
