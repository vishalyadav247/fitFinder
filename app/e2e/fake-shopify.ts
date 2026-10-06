// A fake Shopify for the end-to-end tests, at the HTTP boundary: it answers the `fetch` calls the
// app and @shopify/shopify-api make (token exchange, Admin GraphQL, bulk operation downloads, the
// Partner API) from an in-memory store per shop. Everything inside the app runs for real: the
// library's session-token and app-proxy checks, our webhook HMAC check, Postgres, pg-boss jobs.
// Unknown requests or GraphQL operations fail loudly (recorded in `unknown`), so a new Shopify
// call in the app shows up here instead of silently reaching the network.
import { createHmac, randomUUID } from "node:crypto";

export const API_KEY = "e2e-api-key";
export const API_SECRET = "e2e-api-secret";
export const APP_URL = "https://app.e2e.test";
export const SCOPES = "read_products,write_app_proxy,read_themes,write_files";
export const PARTNER = {
  orgId: "4242",
  token: "e2e-partner-token",
  appGid: "gid://partners/App/4242",
  handle: "fitfinder",
};

export interface FakeVariant {
  id: string;
  sku: string;
}
export interface FakeProduct {
  id: string;
  title: string;
  handle: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED";
  variants: FakeVariant[];
}
export interface FakeCollection {
  id: string;
  handle: string;
  title: string;
}
export interface FakeTheme {
  id: string;
  name: string;
  role: "MAIN" | "UNPUBLISHED" | "DEVELOPMENT";
  files: Record<string, string>;
}

export interface FakeShop {
  domain: string;
  gid: string;
  products: Map<string, FakeProduct>;
  collections: Map<string, FakeCollection>;
  themes: FakeTheme[];
  /** Partner API activeSubscription item handles (null: no plan chosen). */
  subscription: { handles: string[]; trialEndsAt: string | null } | null;
  /** App-data metafields written with metafieldsSet, by "namespace.key". */
  appMetafields: Map<string, string>;
  /** Access tokens handed out by the token exchange. */
  tokens: Set<string>;
  bulk: Map<string, { url: string }>;
}

let nextId = 1000;
const gid = (type: string) => `gid://shopify/${type}/${nextId++}`;

export class FakeShopify {
  readonly shops = new Map<string, FakeShop>();
  /** Requests the fake couldn't answer (asserted empty by the tests). */
  readonly unknown: string[] = [];
  /** Admin GraphQL operation names, in order (for assertions). */
  readonly operations: { shop: string; name: string }[] = [];
  private files = new Map<string, string>();
  /** Operation names answered once with a THROTTLED error (then normally). */
  readonly throttleOnce = new Set<string>();
  /** Status polls a new bulk export answers RUNNING before it is COMPLETED. */
  bulkRunningPolls = 0;
  private bulkPolls = new Map<string, number>();

  shop(domain: string): FakeShop {
    let shop = this.shops.get(domain);
    if (!shop) {
      shop = {
        domain,
        gid: gid("Shop"),
        products: new Map(),
        collections: new Map(),
        themes: [],
        subscription: null,
        appMetafields: new Map(),
        tokens: new Set(),
        bulk: new Map(),
      };
      this.shops.set(domain, shop);
    }
    return shop;
  }

  addProduct(
    domain: string,
    p: { title: string; status?: FakeProduct["status"]; skus: string[] },
  ): FakeProduct {
    const id = gid("Product");
    const handle = p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const product: FakeProduct = {
      id,
      title: p.title,
      handle,
      status: p.status ?? "ACTIVE",
      variants: p.skus.map((sku) => ({ id: gid("ProductVariant"), sku })),
    };
    this.shop(domain).products.set(id, product);
    return product;
  }

  addCollection(domain: string, title: string): FakeCollection {
    const c = {
      id: gid("Collection"),
      handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      title,
    };
    this.shop(domain).collections.set(c.id, c);
    return c;
  }

  addTheme(domain: string, theme: Omit<FakeTheme, "id">): FakeTheme {
    const t = { id: gid("OnlineStoreTheme"), ...theme };
    this.shop(domain).themes.push(t);
    return t;
  }

  /** The `fetch` the app runs with. */
  readonly fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    try {
      if (url.hostname === "fake-files.e2e.test") {
        const body = this.files.get(url.pathname);
        return body === undefined
          ? new Response("not found", { status: 404 })
          : new Response(body);
      }
      if (url.hostname === "partners.shopify.com") {
        return await this.partner(request);
      }
      if (url.hostname.endsWith(".myshopify.com")) {
        const shop = this.shops.get(url.hostname);
        if (!shop) return this.miss(`unknown shop ${url.hostname}`);
        if (url.pathname === "/admin/oauth/access_token") {
          return this.tokenExchange(shop);
        }
        if (/^\/admin\/api\/[^/]+\/graphql\.json$/.test(url.pathname)) {
          const token = request.headers.get("x-shopify-access-token") ?? "";
          if (!shop.tokens.has(token)) {
            return Response.json(
              { errors: "[API] Invalid API key or access token" },
              { status: 401 },
            );
          }
          return await this.graphql(shop, request);
        }
      }
      return this.miss(`${request.method} ${request.url}`);
    } catch (error) {
      return this.miss(`${request.url}: ${String(error)}`);
    }
  };

  private miss(what: string) {
    this.unknown.push(what);
    return new Response(`fake shopify: no handler for ${what}`, {
      status: 599,
    });
  }

  // ------------------------------------------------------------ OAuth token exchange / refresh

  private tokenExchange(shop: FakeShop) {
    const token = `shpat_${randomUUID().replace(/-/g, "")}`;
    shop.tokens.add(token);
    return Response.json({
      access_token: token,
      scope: SCOPES,
      expires_in: 3600,
      refresh_token: `shprt_${randomUUID()}`,
      refresh_token_expires_in: 90 * 86400,
    });
  }

  // ------------------------------------------------------------ Partner API (Shopify App Pricing)

  private async partner(request: Request) {
    if (request.headers.get("x-shopify-access-token") !== PARTNER.token) {
      return Response.json({ errors: "unauthorized" }, { status: 401 });
    }
    const { variables } = (await request.json()) as {
      variables: { appId: string; shopId: string };
    };
    const shop = [...this.shops.values()].find(
      (s) => s.gid === variables.shopId,
    );
    if (variables.appId !== PARTNER.appGid || !shop) {
      return Response.json({ errors: [{ message: "not found" }] });
    }
    const sub = shop.subscription;
    return Response.json({
      data: {
        activeSubscription: sub && {
          billingPeriod: "EVERY_30_DAYS",
          trialEndsAt: sub.trialEndsAt,
          items: sub.handles.map((handle) => ({ handle, description: "" })),
        },
      },
    });
  }

  // ------------------------------------------------------------ Admin GraphQL

  private async graphql(shop: FakeShop, request: Request) {
    const { query, variables = {} } = (await request.json()) as {
      query: string;
      variables?: Record<string, unknown>;
    };
    const name = /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "anonymous";
    this.operations.push({ shop: shop.domain, name });
    if (this.throttleOnce.delete(name)) {
      return Response.json({
        errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
      });
    }
    const handler = this.operations_[name];
    if (!handler) return this.miss(`GraphQL operation ${name}`);
    return Response.json({ data: handler(shop, variables) });
  }

  private readonly operations_: Record<
    string,
    (shop: FakeShop, v: Record<string, unknown>) => unknown
  > = {
    ShopGid: (shop) => ({ shop: { id: shop.gid } }),

    AppInstallationId: (shop) => ({
      currentAppInstallation: {
        id: `gid://shopify/AppInstallation/${shop.gid.split("/").pop()}`,
      },
    }),

    SetAppDataMetafield: (shop, v) => {
      const list = v.metafields as {
        namespace: string;
        key: string;
        value: string;
        type: string;
      }[];
      for (const m of list) {
        if (m.type !== "json") throw new Error(`metafield type ${m.type}`);
        JSON.parse(m.value);
        shop.appMetafields.set(`${m.namespace}.${m.key}`, m.value);
      }
      return {
        metafieldsSet: {
          metafields: list.map(() => ({ id: gid("Metafield") })),
          userErrors: [],
        },
      };
    },

    // Bulk export: completes at once; the JSONL is served from fake-files.e2e.test.
    CatalogBulkExport: (shop) => {
      const id = gid("BulkOperation");
      const lines: string[] = [];
      for (const p of shop.products.values()) {
        lines.push(
          JSON.stringify({
            id: p.id,
            title: p.title,
            handle: p.handle,
            status: p.status,
          }),
        );
        for (const v of p.variants) {
          lines.push(
            JSON.stringify({ id: v.id, sku: v.sku, __parentId: p.id }),
          );
        }
      }
      const path = `/bulk/${encodeURIComponent(id)}.jsonl`;
      this.files.set(path, lines.join("\n") + "\n");
      shop.bulk.set(id, {
        url: lines.length ? `https://fake-files.e2e.test${path}` : "",
      });
      return {
        bulkOperationRunQuery: {
          bulkOperation: { id, status: "CREATED" },
          userErrors: [],
        },
      };
    },

    BulkStatus: (shop, v) => {
      const op = shop.bulk.get(v.id as string);
      const polls = (this.bulkPolls.get(v.id as string) ?? 0) + 1;
      this.bulkPolls.set(v.id as string, polls);
      const running = polls <= this.bulkRunningPolls;
      return {
        bulkOperation: !op
          ? null
          : {
              id: v.id,
              status: running ? "RUNNING" : "COMPLETED",
              errorCode: null,
              objectCount: "0",
              url: running ? null : op.url || null,
              partialDataUrl: null,
            },
      };
    },

    CancelBulk: (_shop, v) => ({
      bulkOperationCancel: {
        bulkOperation: { id: v.id, status: "CANCELING" },
        userErrors: [],
      },
    }),

    CatalogCollections: (shop) => ({
      collections: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [...shop.collections.values()],
      },
    }),

    ProductVariantsPage: (shop, v) => {
      const p = shop.products.get(v.id as string);
      return {
        product: !p
          ? null
          : {
              id: p.id,
              title: p.title,
              handle: p.handle,
              status: p.status,
              variants: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: p.variants,
              },
            },
      };
    },

    PickedResources: (shop, v) => ({
      nodes: (v.ids as string[]).map((id) => {
        const p = shop.products.get(id);
        if (p) {
          return {
            id: p.id,
            title: p.title,
            handle: p.handle,
            status: p.status,
            variants: { nodes: p.variants.slice(0, 1) },
          };
        }
        return shop.collections.get(id) ?? null;
      }),
    }),

    StorefrontThemes: (shop) => ({
      themes: {
        nodes: shop.themes.map(({ id, name, role }) => ({ id, name, role })),
      },
    }),

    ThemeFiles: (shop, v) => {
      const theme = shop.themes.find((t) => t.id === v.id);
      if (!theme) return { theme: null };
      const patterns = (v.filenames as string[]).map(
        (p) =>
          new RegExp(`^${p.replace(/[.]/g, "\\.").replace(/\*/g, "[^/]*")}$`),
      );
      const nodes = Object.entries(theme.files)
        .filter(([f]) => patterns.some((re) => re.test(f)))
        .map(([filename, content]) => ({ filename, body: { content } }));
      return {
        theme: {
          id: theme.id,
          files: { nodes, pageInfo: { hasNextPage: false, endCursor: null } },
        },
      };
    },
  };
}

// ------------------------------------------------------------ signing helpers

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64url");

/** An App Bridge session token (HS256 JWT signed with the app secret), as the admin sends it. */
export function sessionToken(shop: string, now = Date.now()) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const t = Math.floor(now / 1000);
  const payload = b64url(
    JSON.stringify({
      iss: `https://${shop}/admin`,
      dest: `https://${shop}`,
      aud: API_KEY,
      sub: "42",
      exp: t + 60,
      nbf: t - 5,
      iat: t - 5,
      jti: randomUUID(),
      sid: randomUUID(),
    }),
  );
  const signature = createHmac("sha256", API_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/**
 * An app proxy URL as Shopify forwards it: shop, logged_in_customer_id, path_prefix, timestamp
 * and the signature (HMAC-SHA256 hex of the sorted "key=value" pairs, joined without separator).
 */
export function proxyUrl(
  shop: string,
  path: string,
  params: Record<string, string> = {},
  { secret = API_SECRET, timestamp = Math.floor(Date.now() / 1000) } = {},
) {
  const all: Record<string, string> = {
    ...params,
    shop,
    logged_in_customer_id: "",
    path_prefix: "/apps/fitfinder",
    timestamp: String(timestamp),
  };
  const message = Object.keys(all)
    .sort()
    .map((k) => `${k}=${all[k]}`)
    .join("");
  const signature = createHmac("sha256", secret).update(message).digest("hex");
  const q = new URLSearchParams({ ...all, signature });
  return `${APP_URL}/proxy/${path}?${q}`;
}

/** A webhook delivery as Shopify sends it (HMAC-SHA256 base64 of the raw body). */
export function webhookRequest(
  path: string,
  shop: string,
  topic: string,
  payload: unknown,
  { secret = API_SECRET, triggeredAt = new Date() } = {},
) {
  const body = JSON.stringify(payload);
  return new Request(`${APP_URL}${path}`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Topic": topic,
      "X-Shopify-Shop-Domain": shop,
      "X-Shopify-API-Version": "2026-10",
      "X-Shopify-Webhook-Id": randomUUID(),
      "X-Shopify-Event-Id": randomUUID(),
      "X-Shopify-Triggered-At": triggeredAt.toISOString(),
      "X-Shopify-Hmac-Sha256": createHmac("sha256", secret)
        .update(body)
        .digest("base64"),
    },
  });
}
