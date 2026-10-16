// App Store review, end to end: what a Shopify reviewer does with the app, sent through the
// PRODUCTION server build (`npm run build`; middleware, auth, loaders, rendering, document headers
// and error pages, exactly as deployed), with Shopify faked at the HTTP boundary.
// Run: npm run test:review (builds first). Static requirements (config, scopes, theme extension,
// forbidden APIs) are in app/tests/app-review-static.test.ts.
//
// Requirements covered (shopify.dev/docs/apps/launch/app-requirements-checklist):
// install and auth without a shop-domain prompt; embedded in the admin with App Bridge as the
// first script and the frame-ancestors CSP; session-token auth on every admin page, data request
// and API; every page loads without errors, placeholders or stack traces; friendly 404 and outage
// pages; billing through Shopify (appSubscriptionCreate, test charges on development stores,
// return to the app); every webhook in shopify.app.toml answers and checks its HMAC (compliance
// topics included); app proxy checks Shopify's signature; uninstall stops the storefront and a
// reinstall works.
import {
  cleanLeftovers,
  productionHandler,
  shopify,
  stopJobs,
  removeStorage,
  seedPlansForRun,
} from "./harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  API_KEY,
  APP_HANDLE,
  APP_URL,
  SCOPES,
  proxyUrl,
  sessionToken,
  webhookRequest,
} from "./fake-shopify";

const RUN = randomBytes(4).toString("hex");
const SHOP = `e2e-review-${RUN}.myshopify.com`;
const OTHER = `e2e-rival-${RUN}.myshopify.com`;
const { default: prisma } = await import("../db.server");

const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const host = (shop: string) =>
  Buffer.from(`admin.shopify.com/store/${shop.split(".")[0]}`).toString(
    "base64url",
  );

/** Every page in the app's navigation (s-app-nav), plus onboarding. */
const PAGES = [
  "/app",
  "/app/search-setup",
  "/app/filter-data",
  "/app/storefront",
  "/app/product-mapping",
  "/app/analytics",
  "/app/settings",
  "/app/plans",
];
/** In-process (no network), so a slow page is the app's own work (REVIEW_PAGE_BUDGET_MS on a slow machine). */
const PAGE_BUDGET_MS = Number(process.env.REVIEW_PAGE_BUDGET_MS) || 2000;

/**
 * Visible text of a page: no scripts, styles or tags, plus the attributes Polaris web components
 * show as text (heading, label, placeholder…), where a broken value would otherwise hide.
 */
const visibleText = (html: string) => {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const shownAttributes = [
    ...body.matchAll(
      /\s(?:heading|label|placeholder|details|accessibilityLabel|title|alt|value)="([^"]*)"/g,
    ),
  ].map((m) => m[1]);
  return [body.replace(/<[^>]+>/g, " "), ...shownAttributes]
    .join(" ")
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, " ")
    .replace(/\s+/g, " ");
};

/** Things a reviewer must never see on a page. */
const BROKEN = [
  /\bundefined\b/,
  /\bNaN\b/,
  /\[object Object\]/,
  /\bnull\b/,
  /lorem ipsum/i,
  /\bTODO\b|\bFIXME\b/,
  /\bat [\w.<>]+ \([^)]*\.(?:ts|tsx|js|mjs):\d+/, // stack frames
  /node_modules/,
  /Unexpected Server Error/i,
  /Application Error/i,
];

function expectCleanPage(html: string, where: string) {
  const text = visibleText(html);
  for (const re of BROKEN) {
    expect(text, `${where} shows ${re}`).not.toMatch(re);
  }
}

describe("App Store review (production build)", () => {
  let handler: (request: Request) => Promise<Response>;
  let restorePlans: () => Promise<void> = async () => {};

  /** A document load inside the Shopify admin iframe, as the admin opens it. */
  const embedded = (path: string, shop = SHOP, token = true) => {
    const url = new URL(path, APP_URL);
    url.searchParams.set("embedded", "1");
    url.searchParams.set("shop", shop);
    url.searchParams.set("host", host(shop));
    if (token) url.searchParams.set("id_token", sessionToken(shop));
    return new Request(url, {
      headers: { Accept: "text/html", "User-Agent": CHROME },
    });
  };
  /** A fetch from the embedded app (App Bridge adds the session token). */
  const fetchApi = (
    path: string,
    {
      shop = SHOP,
      method = "GET",
      form,
    }: { shop?: string; method?: string; form?: Record<string, string> } = {},
  ) =>
    new Request(new URL(path, APP_URL), {
      method,
      headers: {
        Authorization: `Bearer ${sessionToken(shop)}`,
        "User-Agent": CHROME,
        ...(form
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
      },
      body: form ? new URLSearchParams(form) : undefined,
    });
  /** Follows redirects inside the app (each hop re-sends the session token, like App Bridge). */
  const open = async (path: string, shop = SHOP) => {
    let res = await handler(embedded(path, shop));
    for (
      let hops = 0;
      hops < 5 && res.status >= 300 && res.status < 400;
      hops++
    ) {
      const next = new URL(res.headers.get("location")!, APP_URL);
      next.searchParams.set("id_token", sessionToken(shop));
      res = await handler(
        new Request(next, {
          headers: { Accept: "text/html", "User-Agent": CHROME },
        }),
      );
    }
    return { res, html: await res.text() };
  };

  beforeAll(async () => {
    await cleanLeftovers();
    restorePlans = await seedPlansForRun();
    shopify.shop(OTHER);
    shopify.addProduct(SHOP, { title: "Brake Pad Set", skus: ["BP-100"] });
    shopify.addTheme(SHOP, { name: "Horizon", role: "MAIN", files: {} });
    handler = await productionHandler();
  });

  afterAll(async () => {
    shopify.tokenExchangeDown = false;
    // Each step on its own: one failing must not leave the others' data behind.
    const steps = [
      restorePlans,
      stopJobs,
      () =>
        prisma.session.deleteMany({ where: { shop: { in: [SHOP, OTHER] } } }),
      () =>
        prisma.shop.deleteMany({ where: { domain: { in: [SHOP, OTHER] } } }),
      () =>
        prisma.appLog.deleteMany({
          where: { shopDomain: { in: [SHOP, OTHER] } },
        }),
      async () => removeStorage(),
    ];
    const failed: unknown[] = [];
    for (const step of steps)
      await step().catch((e: unknown) => failed.push(e));
    if (failed.length) throw failed[0];
  });

  it("the app URL outside Shopify asks for no shop domain and has no broken text (2.3.1)", async () => {
    const res = await handler(
      new Request(`${APP_URL}/`, { headers: { Accept: "text/html" } }),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toMatch(/<input[^>]*name="shop"/i);
    expect(html).not.toMatch(/myshopify\.com.*<\/label>|shop domain/i);
    expect(visibleText(html)).toContain("SpareFit");
    expectCleanPage(html, "/");
    // A link that carries the shop goes into the app.
    const withShop = await handler(new Request(`${APP_URL}/?shop=${SHOP}`));
    expect(withShop.status).toBe(302);
    expect(withShop.headers.get("location")).toBe(`/app?shop=${SHOP}`);
    // No login page with a shop field either (installs are managed by Shopify): the login path
    // goes to the landing page, or with a shop straight to Shopify's install.
    const login = await handler(
      new Request(`${APP_URL}/auth/login`, {
        headers: { Accept: "text/html" },
      }),
    );
    expect(login.status).toBe(302);
    expect(login.headers.get("location")).toBe("/");
    const install = await handler(
      new Request(`${APP_URL}/auth/login?shop=${SHOP}`, {
        headers: { Accept: "text/html" },
      }),
    );
    expect(install.status).toBe(302);
    expect(install.headers.get("location")).toContain(SHOP.split(".")[0]);
    const bad = await handler(
      new Request(`${APP_URL}/auth/login?shop=evil.example.com`),
    );
    expect(bad.headers.get("location")).toBe("/");
  });

  it("first open after install: authenticated by session token, straight into onboarding (1.1.1, 2.3)", async () => {
    // Without a token the library bounces to get one (no login form, no error).
    const bounce = await handler(embedded("/app", SHOP, false));
    expect(bounce.status).toBe(302);
    expect(bounce.headers.get("location")).toMatch(/^\/auth\/session-token\?/);

    const { res, html } = await open("/app");
    expect(res.status).toBe(200);
    expect(html).toContain("Welcome to SpareFit"); // onboarding
    expect(await prisma.shop.count({ where: { domain: SHOP } })).toBe(1);
  });

  it("is embedded properly: App Bridge first, API key, frame-ancestors CSP, no cookies (2.2)", async () => {
    const { res, html } = await open("/app/onboarding");
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(
      `frame-ancestors https://${SHOP} https://admin.shopify.com`,
    );
    // App Bridge from Shopify's CDN must be the first script on the page.
    const firstScript = /<script\b[^>]*>/i.exec(html)?.[0] ?? "";
    expect(firstScript).toContain(
      'src="https://cdn.shopify.com/shopifycloud/app-bridge.js"',
    );
    expect(html).toMatch(
      new RegExp(
        `<meta name="shopify-api-key" content="${API_KEY}"|data-api-key="${API_KEY}"`,
      ),
    );
    expect(html).toContain("https://cdn.shopify.com/shopifycloud/polaris.js");
    // Embedded apps can't rely on cookies (third-party in the admin iframe).
    expect(res.headers.get("set-cookie")).toBeNull();
    // A made-up shop parameter never widens who may frame the app.
    const spoofed = await handler(embedded("/app", "evil.example.com", false));
    expect(spoofed.status).toBeLessThan(500);
    expect(spoofed.headers.get("content-security-policy") ?? "").not.toContain(
      "evil.example.com",
    );
    // A real shop without a token: bounced for one, with the CSP for that shop only.
    const bounce = await handler(embedded("/app", SHOP, false));
    expect(bounce.status).toBe(302);
  });

  it("onboarding works, then every page in the navigation loads cleanly and quickly", async () => {
    const chosen = await handler(
      fetchApi("/app/onboarding.data", {
        method: "POST",
        form: { storeType: "automotive", replace: "false" },
      }),
    );
    expect(chosen.status).toBeLessThan(400);
    expect(
      await prisma.searchConfig.count({ where: { shop: { domain: SHOP } } }),
    ).toBe(1);

    // One filter row, so pages show data, not only empty states.
    const fields = await prisma.searchField.findMany({
      where: { shop: { domain: SHOP } },
      orderBy: { position: "asc" },
    });
    const values = ["Audi", "2010", "A4"];
    const added = await handler(
      fetchApi("/app/filter-data.data", {
        method: "POST",
        form: {
          intent: "add",
          attachment: "BP-100",
          ...Object.fromEntries(fields.map((f, i) => [f.id, values[i] ?? "x"])),
        },
      }),
    );
    expect(added.status).toBeLessThan(400);

    const dashboard = await open("/app");
    // The navigation lists every page, Plans included (pricing reachable in the app).
    for (const page of PAGES) {
      expect(dashboard.html).toContain(`href="${page}"`);
    }
    for (const page of PAGES) {
      const started = performance.now();
      const { res, html } = await open(page);
      const ms = performance.now() - started;
      expect(res.status, page).toBe(200);
      expect(res.headers.get("content-type"), page).toContain("text/html");
      expect(res.headers.get("content-security-policy"), page).toContain(
        "frame-ancestors",
      );
      expectCleanPage(html, page);
      expect(ms, `${page} took ${Math.round(ms)} ms`).toBeLessThan(
        PAGE_BUDGET_MS,
      );
    }
  });

  it("data requests and the app's API refuse requests without a valid session token", async () => {
    // With the token: data.
    const rows = await handler(fetchApi("/api/fitment?pageSize=10"));
    expect(rows.status).toBe(200);
    expect((await rows.json()).rows).toHaveLength(1);
    expect(rows.headers.get("set-cookie")).toBeNull();

    // Without it, or with a forged one: no data (App Bridge's re-auth answer instead).
    for (const req of [
      new Request(`${APP_URL}/api/fitment?pageSize=10`),
      new Request(`${APP_URL}/api/fitment?pageSize=10`, {
        headers: {
          Authorization: `Bearer ${sessionToken(SHOP).slice(0, -4)}AAAA`,
        },
      }),
      new Request(`${APP_URL}/app/filter-data.data`),
    ]) {
      const res = await handler(req);
      const body = await res.text();
      expect(body).not.toContain("BP-100");
      expect(res.status === 401 || body.includes("app-bridge.js")).toBe(true);
    }
    // Another shop's token sees none of this shop's rows.
    const rival = await open("/app", OTHER);
    expect(rival.res.status).toBe(200);
    const theirs = await handler(
      fetchApi("/api/fitment?pageSize=10", { shop: OTHER }),
    );
    expect((await theirs.json()).rows).toHaveLength(0);
  });

  it("unknown pages and Shopify outages show friendly pages, never stack traces", async () => {
    const outside = await handler(
      new Request(`${APP_URL}/no-such-page`, {
        headers: { Accept: "text/html" },
      }),
    );
    expect(outside.status).toBe(404);
    const outsideHtml = await outside.text();
    expect(visibleText(outsideHtml)).toContain("Page not found");
    expectCleanPage(outsideHtml, "/no-such-page");

    const inside = await open("/app/no-such-page");
    expect(inside.res.status).toBe(404);
    expectCleanPage(inside.html, "/app/no-such-page");
    // Inside the app: the app's own page (Polaris banner heading), App Bridge and the menu stay.
    expect(inside.html).toContain('heading="Page not found"');
    expect(visibleText(inside.html)).toContain("Use the app menu");
    expect(inside.html).toContain("app-bridge.js");
    expect(visibleText(inside.html)).not.toMatch(/No route matches/i);

    // Shopify down while a new shop opens the app: an error page, not a crash dump.
    const NEW = `e2e-outage-${RUN}.myshopify.com`;
    shopify.shop(NEW);
    shopify.tokenExchangeDown = true;
    try {
      const res = await handler(embedded("/app", NEW));
      const html = await res.text();
      // The app's own "Something went wrong" page (root boundary), not a crash dump.
      expect(res.status).toBe(500);
      expect(visibleText(html)).toContain("Something went wrong");
      expectCleanPage(html, "outage");
      expect(html).not.toContain("shpat_");
    } finally {
      shopify.tokenExchangeDown = false;
      await prisma.session.deleteMany({ where: { shop: NEW } });
      await prisma.shop.deleteMany({ where: { domain: NEW } });
    }
  });

  it("charges go through Shopify Billing: test charge on a dev store, approval in the admin, back to the app (1.2)", async () => {
    const plans = await open("/app/plans");
    expect(plans.res.status).toBe(200);
    const growth = await prisma.plan.findUniqueOrThrow({
      where: { key: "growth" },
    });
    expect(visibleText(plans.html)).toContain(growth.name);

    const before = shopify.shop(SHOP).charges.length;
    const res = await handler(
      fetchApi("/app/plans.data", {
        method: "POST",
        form: { intent: "subscribe", plan: "growth", interval: "monthly" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    const charges = shopify.shop(SHOP).charges;
    expect(charges.length).toBe(before + 1);
    const charge = charges[charges.length - 1];
    // Shopify's approval page on the shop's own admin.
    expect(body).toContain(`https://${SHOP}/admin/charges/confirm`);
    expect(charge.variables).toMatchObject({
      test: true, // development stores get test charges
      trialDays: growth.trialDays,
    });
    // After approving, the merchant comes back into the app in the admin.
    // Exactly the Plans page with the return marker (it makes the page read the plan fresh).
    expect(String(charge.variables.returnUrl)).toBe(
      `https://admin.shopify.com/store/${SHOP.split(".")[0]}/apps/${APP_HANDLE}/app/plans?charge=1`,
    );
  });

  it("plans change in the app without support: upgrade replaces the charge, free cancels it (1.2.3)", async () => {
    const plan = async () =>
      (await prisma.shop.findUniqueOrThrow({ where: { domain: SHOP } })).plan;
    const post = (form: Record<string, string>) =>
      handler(fetchApi("/app/plans.data", { method: "POST", form }));

    // The merchant approves Growth in Shopify and comes back to the Plans page.
    const growth = shopify.approveCharge(SHOP);
    const back = await open("/app/plans?charge=1");
    expect(back.res.status).toBe(200);
    expect(await plan()).toBe("growth");

    // Upgrade to Pro: a new charge that replaces Growth once approved (no double billing).
    expect(
      (await post({ intent: "subscribe", plan: "pro", interval: "monthly" }))
        .status,
    ).toBe(200);
    const charges = shopify.shop(SHOP).charges;
    const pro = charges[charges.length - 1];
    expect(pro.variables).toMatchObject({ replacementBehavior: "STANDARD" });
    shopify.approveCharge(SHOP);
    await open("/app/plans?charge=1");
    expect(await plan()).toBe("pro");
    // The app's own record: Pro is the one active charge, Growth has ended.
    const shopRow = await prisma.shop.findUniqueOrThrow({
      where: { domain: SHOP },
    });
    expect(shopRow.subscriptionId).toBe(pro.id);
    const active = await prisma.appSubscription.findMany({
      where: { shop: { domain: SHOP }, status: "ACTIVE", endedAt: null },
    });
    expect(active.map((a) => a.shopifyId)).toEqual([pro.id]);
    expect(growth.id).not.toBe(pro.id);

    // Down to the free plan: the paid charge is cancelled through the Billing API.
    const cancels = shopify.operations.filter(
      (o) => o.name === "SubscriptionCancel",
    ).length;
    const free = await post({ intent: "free", plan: "starter" });
    expect(free.status).toBe(200);
    expect(
      shopify.operations.filter((o) => o.name === "SubscriptionCancel").length,
    ).toBe(cancels + 1);
    expect(pro.status).toBe("CANCELLED");
    expect(await plan()).toBe("starter");
  });

  it("forcing test charges is refused in production, even when configured (1.2.2)", async () => {
    const env = { ...process.env };
    shopify.liveStores.add(SHOP);
    process.env.NODE_ENV = "production";
    process.env.SHOPIFY_BILLING_TEST = "true";
    try {
      const res = await handler(
        fetchApi("/app/plans.data", {
          method: "POST",
          form: { intent: "subscribe", plan: "growth", interval: "yearly" },
        }),
      );
      expect(res.status).toBe(200);
      const charges = shopify.shop(SHOP).charges;
      expect(charges[charges.length - 1].variables).toMatchObject({
        test: false,
      });
    } finally {
      shopify.liveStores.delete(SHOP);
      process.env.NODE_ENV = env.NODE_ENV;
      if (env.SHOPIFY_BILLING_TEST === undefined)
        delete process.env.SHOPIFY_BILLING_TEST;
      else process.env.SHOPIFY_BILLING_TEST = env.SHOPIFY_BILLING_TEST;
    }
  });

  it("a real (non-development) store gets a real charge, never a test one (1.2.2)", async () => {
    shopify.liveStores.add(SHOP);
    try {
      const res = await handler(
        fetchApi("/app/plans.data", {
          method: "POST",
          form: { intent: "subscribe", plan: "growth", interval: "monthly" },
        }),
      );
      expect(res.status).toBe(200);
      const charges = shopify.shop(SHOP).charges;
      expect(charges[charges.length - 1].variables).toMatchObject({
        test: false,
      });
    } finally {
      shopify.liveStores.delete(SHOP);
    }
  });

  it("every webhook in shopify.app.toml answers, and refuses a wrong HMAC (incl. compliance)", async () => {
    const toml = readFileSync("shopify.app.toml", "utf8");
    // Each [[webhooks.subscriptions]] block, up to the next table header.
    const blocks = toml
      .split("[[webhooks.subscriptions]]")
      .slice(1)
      .map((b) => b.split(/\n\s*\[(?!\[)/)[0]);
    const subscriptions = blocks.map((block) => {
      const topics = [
        ...(
          /(?:^|\n)\s*(?:topics|compliance_topics)\s*=\s*\[([^\]]*)\]/.exec(
            block,
          )?.[1] ?? ""
        ).matchAll(/"([^"]+)"/g),
      ].map((t) => t[1]);
      return { uri: /uri\s*=\s*"([^"]+)"/.exec(block)![1], topics };
    });
    const all = subscriptions.flatMap((s) =>
      s.topics.map((topic) => ({ uri: s.uri, topic })),
    );
    expect(all.map((t) => t.topic)).toEqual(
      expect.arrayContaining([
        "app/uninstalled",
        "customers/data_request",
        "customers/redact",
        "shop/redact",
      ]),
    );

    const payload = (topic: string): unknown => {
      if (topic.startsWith("products/")) {
        return {
          id: 999999,
          admin_graphql_api_id: "gid://shopify/Product/999999",
        };
      }
      if (topic === "app_subscriptions/update") {
        return {
          app_subscription: {
            admin_graphql_api_id: "gid://shopify/AppSubscription/1",
            status: "ACTIVE",
          },
        };
      }
      if (topic === "app/scopes_update") return { current: ["read_products"] };
      return { shop_domain: SHOP, shop_id: 1 };
    };
    // The uninstall goes last (it ends the shop's install).
    const ordered = [
      ...all.filter((t) => t.topic !== "app/uninstalled"),
      ...all.filter((t) => t.topic === "app/uninstalled"),
    ];
    for (const { uri, topic } of ordered) {
      const forged = await handler(
        webhookRequest(uri, SHOP, topic, payload(topic), { secret: "wrong" }),
      );
      expect(forged.status, `${topic} with a wrong HMAC`).toBe(401);
      if (topic === "app/uninstalled") continue;
      const ok = await handler(
        webhookRequest(uri, SHOP, topic, payload(topic)),
      );
      expect(ok.status, `${topic}`).toBe(200);
    }

    // What they did: shop/redact for a shop that is still installed changes nothing (the purge
    // only follows a real uninstall); scopes_update stored the granted scopes.
    const shop = await prisma.shop.findUniqueOrThrow({
      where: { domain: SHOP },
    });
    expect(shop.uninstalledAt).toBeNull();
    const offline = await prisma.session.findFirstOrThrow({
      where: { shop: SHOP, isOnline: false },
    });
    expect(offline.scope).toBe("read_products");
    // Put the full scopes back, as Shopify would after the merchant approves them.
    const scopes = await handler(
      webhookRequest("/webhooks/app/scopes_update", SHOP, "app/scopes_update", {
        current: SCOPES.split(","),
      }),
    );
    expect(scopes.status).toBe(200);
    // A charge the app doesn't know adds nothing.
    expect(
      await prisma.appSubscription.count({
        where: { shopifyId: "gid://shopify/AppSubscription/1" },
      }),
    ).toBe(0);
  });

  it("the storefront calls only work with Shopify's app proxy signature", async () => {
    const field = await prisma.searchField.findFirstOrThrow({
      where: { shop: { domain: SHOP } },
      orderBy: { position: "asc" },
    });
    const signed = await handler(
      new Request(proxyUrl(SHOP, "options", { field: field.id })),
    );
    expect(signed.status).toBe(200);
    expect(await signed.json()).toMatchObject({ options: ["Audi"] });
    expect(signed.headers.get("set-cookie")).toBeNull();

    const forged = await handler(
      new Request(
        proxyUrl(SHOP, "options", { field: field.id }, { secret: "x" }),
      ),
    );
    expect(forged.status).toBe(400);
    const unsigned = await handler(
      new Request(`${APP_URL}/proxy/options?shop=${SHOP}&field=${field.id}`),
    );
    expect(unsigned.status).toBe(400);
    // Every storefront route checks it, not only the dropdowns.
    for (const route of ["search", "results", "fits"]) {
      const res = await handler(
        new Request(
          proxyUrl(
            SHOP,
            route,
            { [field.id]: "Audi", product: "1" },
            { secret: "x" },
          ),
        ),
      );
      expect(res.status, `/proxy/${route} with a forged signature`).toBe(400);
    }
  });

  it("one store can't change another store's data, and nothing is written without a session", async () => {
    const row = await prisma.fitmentRow.findFirstOrThrow({
      where: { shop: { domain: SHOP } },
    });
    // The rival store (its own valid token) tries to delete and edit this store's row.
    const attempts: Record<string, string>[] = [
      { intent: "delete", ids: JSON.stringify([String(row.id)]) },
      { intent: "edit", rowId: String(row.id), attachment: "HACKED" },
    ];
    for (const form of attempts) {
      const res = await handler(
        fetchApi("/app/filter-data.data", {
          shop: OTHER,
          method: "POST",
          form,
        }),
      );
      expect(res.status).toBeLessThan(500);
    }
    const after = await prisma.fitmentRow.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(after.attachment).toBe("BP-100");

    // Writes without a session token: refused, nothing changed.
    const before = JSON.stringify(
      await prisma.storefrontSettings.findUnique({
        where: { shopId: row.shopId },
      }),
    );
    for (const req of [
      new Request(`${APP_URL}/api/storefront-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "heading", value: "Hacked" }),
      }),
      new Request(`${APP_URL}/api/imports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "create", fileName: "x.csv" }),
      }),
      new Request(`${APP_URL}/app/plans.data`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "intent=free&plan=starter",
      }),
    ]) {
      const res = await handler(req);
      const body = await res.text();
      expect(
        res.status === 401 || body.includes("app-bridge.js"),
        req.url,
      ).toBe(true);
      expect(body).not.toMatch(/"ok":\s*true/);
    }
    expect(
      JSON.stringify(
        await prisma.storefrontSettings.findUnique({
          where: { shopId: row.shopId },
        }),
      ),
    ).toBe(before);

    // The super admin's backoffice is behind its own sign-in.
    const backoffice = await handler(new Request(`${APP_URL}/backoffice`));
    expect(backoffice.status).toBe(302);
    expect(backoffice.headers.get("location")).toBe("/backoffice/login");
  });

  it("uninstall on a paid plan stops the storefront and the plan; a reinstall starts clean", async () => {
    const field = await prisma.searchField.findFirstOrThrow({
      where: { shop: { domain: SHOP } },
    });
    // On Growth when uninstalling.
    await handler(
      fetchApi("/app/plans.data", {
        method: "POST",
        form: { intent: "subscribe", plan: "growth", interval: "monthly" },
      }),
    );
    shopify.approveCharge(SHOP);
    await open("/app/plans?charge=1");
    expect(
      (await prisma.shop.findUniqueOrThrow({ where: { domain: SHOP } })).plan,
    ).toBe("growth");

    // Shopify cancels the app's charges when it is uninstalled, then sends the webhook.
    for (const c of shopify.shop(SHOP).charges) {
      if (c.status === "ACTIVE") c.status = "CANCELLED";
    }
    const gone = await handler(
      webhookRequest("/webhooks/app/uninstalled", SHOP, "app/uninstalled", {
        domain: SHOP,
      }),
    );
    expect(gone.status).toBe(200);
    expect(await prisma.session.count({ where: { shop: SHOP } })).toBe(0);
    const proxy = await handler(
      new Request(proxyUrl(SHOP, "options", { field: field.id })),
    );
    expect(proxy.status).toBe(404);

    // Reinstalled: the admin opens the app again, with its setup still there (kept 30 days).
    const back = await open("/app");
    expect(back.res.status).toBe(200);
    expectCleanPage(back.html, "reinstall");
    const shop = await prisma.shop.findUniqueOrThrow({
      where: { domain: SHOP },
    });
    expect(shop.uninstalledAt).toBeNull();
    // No paid plan carried over: the merchant picks one again (the charge ended with the install).
    const plans = await open("/app/plans");
    expect(plans.res.status).toBe(200);
    const after = await prisma.shop.findUniqueOrThrow({
      where: { domain: SHOP },
    });
    expect(after.plan).not.toBe("growth");
    expect(
      await prisma.appSubscription.count({
        where: { shopId: after.id, status: "ACTIVE", endedAt: null },
      }),
    ).toBe(0);
  });

  it("never sent a request the fake Shopify didn't know", () => {
    expect(shopify.unknown).toEqual([]);
  });
});
