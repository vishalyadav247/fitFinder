// App Store review, static half: what reviewers (and Shopify's automated checks) read from the
// app's configuration, code and theme extension. The HTTP half is app/e2e/app-review.e2e.test.ts.
// Requirements: shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements (fetched
// 2026-10-16): 1.1.1 session tokens, 1.2.1 Shopify billing only, 2.2.2 embedded, 2.2.3 App
// Bridge, 2.2.4 GraphQL Admin API only, 3.1.1 TLS, minimal scopes, compliance webhooks, 5.1.x
// theme app extensions only, storefront performance and branding.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { ApiVersion } from "@shopify/shopify-app-react-router/server";

const read = (file: string) => readFileSync(file, "utf8");

/** Value of a top-level `key = "..."` or `key = [ ... ]` in a TOML file (simple, flat use). */
function tomlValue(toml: string, key: string): string | undefined {
  return new RegExp(`(?:^|\\n)\\s*${key}\\s*=\\s*"([^"]*)"`).exec(toml)?.[1];
}
function tomlList(toml: string, key: string): string[] {
  const raw = new RegExp(`(?:^|\\n)\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`).exec(
    toml,
  )?.[1];
  return raw ? [...raw.matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
}
/** Webhook subscriptions: [{ uri, topics }] (topics or compliance_topics). */
function webhooks(toml: string) {
  return toml
    .split("[[webhooks.subscriptions]]")
    .slice(1)
    .map((b) => b.split(/\n\s*\[(?!\[)/)[0])
    .map((block) => ({
      uri: tomlValue(block, "uri"),
      topics: [
        ...tomlList(block, "topics"),
        ...tomlList(block, "compliance_topics"),
      ],
    }));
}

/** Source files of the app (no tests, no e2e fakes). */
function sources(dir = "app"): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) {
      return name === "e2e" || name === "tests" ? [] : sources(file);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)
      ? [file]
      : [];
  });
}

const PROD = read("shopify.app.toml");
const DEV = read("shopify.app.dev.toml");
const SCOPES = [
  "read_products",
  "write_app_proxy",
  "read_themes",
  "write_files",
];
// Protected or sensitive data the app must not ask for (it stores no customer data).
const FORBIDDEN_SCOPES =
  /customer|order|draft_order|fulfillment|payment|gift_card|read_users|all_orders/;

describe("App Store review: app configuration", () => {
  it("production config: HTTPS app URL on the app's own host, embedded, managed install (2.2.2, 3.1.1)", () => {
    const url = new URL(tomlValue(PROD, "application_url")!);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).not.toMatch(
      /example\.(com|org)|localhost|trycloudflare|ngrok|127\.0\.0\.1|REPLACE/i,
    );
    for (const redirect of tomlList(PROD, "redirect_urls")) {
      expect(new URL(redirect).origin).toBe(url.origin);
    }
    expect(PROD).toMatch(/\nembedded\s*=\s*true/);
    expect(PROD).not.toMatch(/use_legacy_install_flow\s*=\s*true/);
    expect(tomlValue(PROD, "name")).toBe(tomlValue(DEV, "name"));
  });

  it("asks only for the scopes it uses, none protected, same in dev and production", () => {
    for (const toml of [PROD, DEV]) {
      const scopes = tomlValue(toml, "scopes")!
        .split(",")
        .map((s) => s.trim());
      expect(scopes.sort()).toEqual([...SCOPES].sort());
      for (const scope of scopes) expect(scope).not.toMatch(FORBIDDEN_SCOPES);
    }
    const example = read(".env.example");
    const envScopes = /\nSCOPES=([^\n]*)/.exec(example)?.[1];
    if (envScopes)
      expect(envScopes.split(",").sort()).toEqual([...SCOPES].sort());
  });

  it("webhooks: uninstall and the three compliance topics, same API version as the code", () => {
    const topics = webhooks(PROD).flatMap((w) => w.topics);
    expect(topics).toEqual(
      expect.arrayContaining([
        "app/uninstalled",
        "customers/data_request",
        "customers/redact",
        "shop/redact",
      ]),
    );
    // Each topic once, each URI a route of the app.
    expect(new Set(topics).size).toBe(topics.length);
    for (const { uri } of webhooks(PROD)) {
      const route = `app/routes/${uri!.slice(1).replace(/\//g, ".")}.tsx`;
      expect(() => statSync(route), `${uri} → ${route}`).not.toThrow();
    }
    // The dev app gets the same webhooks.
    expect(webhooks(DEV)).toEqual(webhooks(PROD));

    const version = tomlValue(PROD, "api_version");
    expect(tomlValue(DEV, "api_version")).toBe(version);
    const name = /ApiVersion\.(\w+)/.exec(read("app/shopify.server.ts"))?.[1];
    expect(ApiVersion[name as keyof typeof ApiVersion]).toBe(version);
  });

  it("the app proxy matches the storefront scripts (/apps/sparefit → /proxy)", () => {
    for (const toml of [PROD, DEV]) {
      const proxy = toml.split("[app_proxy]")[1] ?? "";
      expect(tomlValue(proxy, "url")).toBe("/proxy");
      expect(tomlValue(proxy, "prefix")).toBe("apps");
      expect(tomlValue(proxy, "subpath")).toBe("sparefit");
    }
  });
});

describe("App Store review: code", () => {
  const files = sources();
  const code = files.map((file) => ({ file, text: read(file) }));
  const offenders = (re: RegExp) =>
    code.filter(({ text }) => re.test(text)).map(({ file }) => file);

  it("scans the whole app (a scan of nothing would pass every check)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(path.join("app", "routes", "app.tsx"));
    expect(webhooks(PROD).length).toBeGreaterThanOrEqual(5);
  });

  it("uses only the GraphQL Admin API: no REST, ScriptTag or Asset API (2.2.4, 5.1.1)", () => {
    expect(offenders(/\/admin\/api\/[^"'`\s]*\.json/)).toEqual([]);
    expect(offenders(/\.rest\.(get|post|put|delete)\b|admin\.rest\b/)).toEqual(
      [],
    );
    expect(offenders(/scriptTag|script_tags|ScriptTagInput/)).toEqual([]);
    expect(offenders(/themeFilesUpsert|assets\.json|asset\[key\]/)).toEqual([]);
  });

  it("charges only through Shopify's Billing API (1.2.1)", () => {
    const pkg = read("package.json");
    expect(pkg).not.toMatch(
      /"(stripe|@stripe\/[^"]+|paypal[^"]*|braintree|@paddle\/[^"]+|chargebee[^"]*)"/i,
    );
    expect(
      offenders(/api\.stripe\.com|paypal\.com|checkout\.session/i),
    ).toEqual([]);
    expect(offenders(/appSubscriptionCreate/)).toEqual([
      path.join("app", "services", "subscription.server.ts"),
    ]);
  });

  it("works without cookies in the admin: session tokens, no document.cookie (1.1.1)", () => {
    expect(offenders(/document\.cookie/)).toEqual([]);
    // Every exported loader and action of an admin page or API authenticates with the session
    // token (comments don't count); storefront routes check the app proxy signature; webhooks
    // check the HMAC.
    const code = (file: string) =>
      read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    const routes = readdirSync("app/routes").map((f) =>
      path.join("app", "routes", f),
    );
    const admin = routes.filter((f) => /[\\/](app|api)\.[^\\/]*\.tsx$/.test(f));
    expect(admin.length).toBeGreaterThan(15);
    for (const file of admin) {
      const text = code(file);
      const exported =
        text.match(/^export (const|async function) (loader|action)\b/gm) ?? [];
      const checks = text.match(/authenticate\.admin\(request\)/g) ?? [];
      expect(checks.length, file).toBeGreaterThanOrEqual(exported.length);
    }
    for (const file of routes.filter((f) =>
      /[\\/]proxy\.[^\\/]*\.tsx$/.test(f),
    )) {
      expect(code(file), file).toMatch(/await proxyContext\(request\)/);
    }
    expect(code("app/services/storefront/proxy.server.ts")).toMatch(
      /authenticate\.public\.appProxy\(/,
    );
    for (const file of routes.filter((f) =>
      /[\\/]webhooks\.[^\\/]*\.tsx$/.test(f),
    )) {
      expect(code(file), file).toMatch(
        /authenticate\.webhook\(request\)|verifyWebhook\(request\)/,
      );
    }
  });

  it("uses the current App Bridge from Shopify's CDN, not the legacy npm package (2.2.3)", () => {
    expect(offenders(/from ["']@shopify\/app-bridge(\/[^"']*)?["']/)).toEqual(
      [],
    );
    expect(read("package.json")).not.toMatch(/"@shopify\/app-bridge"\s*:/);
    // The admin layout renders Shopify's AppProvider (App Bridge + Polaris from the CDN); the
    // HTTP review suite checks it is the first script on every page.
    expect(read("app/routes/app.tsx")).toMatch(
      /from "@shopify\/shopify-app-react-router\/react"[\s\S]*<AppProvider apiKey=/,
    );
  });

  it("stores no customer data (protected customer data, 5.1.5)", () => {
    // Offline tokens only: no merchant-staff user data in sessions either.
    expect(read("app/shopify.server.ts")).not.toMatch(
      /useOnlineTokens:\s*true/,
    );
    const schema = read("prisma/schema.prisma");
    const models = schema.split(/\nmodel /).slice(1);
    for (const model of models) {
      const name = model.split(/\s/)[0];
      // The backoffice super admin's own sign-in email; and Shopify's session storage, whose
      // user columns are only filled for online tokens (the app uses offline tokens only).
      if (name === "BackofficeAdmin" || name === "Session") continue;
      expect(model, name).not.toMatch(
        /\n\s+(email|phone|firstName|lastName|address\w*|customer\w*)\s/i,
      );
    }
  });
});

describe("App Store review: theme app extension (5.1)", () => {
  const dir = "extensions/sparefit-theme";
  const assets = readdirSync(`${dir}/assets`).map((name) => ({
    name,
    text: read(`${dir}/assets/${name}`),
  }));
  const blocks = readdirSync(`${dir}/blocks`).map((name) => ({
    name,
    text: read(`${dir}/blocks/${name}`),
  }));

  it("is a theme app extension with blocks and an app embed (no theme edits)", () => {
    expect(read(`${dir}/shopify.extension.toml`)).toMatch(/type\s*=\s*"theme"/);
    const targets = blocks.map(
      ({ text }) => /"target"\s*:\s*"(\w+)"/.exec(text)?.[1],
    );
    expect(targets).toContain("body"); // the app embed
    expect(targets).toContain("section");
  });

  it("keeps the storefront fast: small assets, deferred scripts, non-blocking CSS, no jQuery", () => {
    for (const { name, text } of assets) {
      // Shopify: keep each JavaScript file under 10 KB; CSS small too.
      expect(Buffer.byteLength(text), name).toBeLessThan(10 * 1024);
      expect(gzipSync(text).length, name).toBeLessThan(5 * 1024);
      expect(text, name).not.toMatch(/jquery/i);
    }
    const liquidBytes = blocks.reduce(
      (n, b) => n + Buffer.byteLength(b.text),
      0,
    );
    expect(liquidBytes).toBeLessThan(100 * 1024);
    for (const { name, text } of blocks) {
      // Scripts come in through the schema ("javascript", loaded deferred by Shopify); inline
      // <script> tags only carry JSON data.
      for (const tag of text.match(/<script\b[^>]*>/gi) ?? []) {
        expect(tag, name).toMatch(/type="application\/json"|defer|async/);
      }
      expect(text, name).not.toMatch(/\|\s*script_tag/);
      // Render-blocking stylesheet tag (styles come via the schema or a print-media link).
      expect(text, name).not.toMatch(/\|\s*stylesheet_tag/);
      // A stylesheet <link> must not block rendering.
      for (const link of text.match(/<link\b[^>]*rel="stylesheet"[^>]*>/gi) ??
        []) {
        expect(link, name).toMatch(/media="print"[^>]*onload=/);
      }
    }
  });

  it("shows shoppers the store's own words, not the app's brand (5.1.4)", () => {
    for (const { name, text } of assets) {
      // Storage keys like "sparefit:selection" and caught internal errors are fine; visible text
      // isn't.
      const shown = text.replace(/new Error\([^)]*\)/g, "");
      expect(shown, name).not.toMatch(/SpareFit|Parts Finder/);
    }
    for (const { name, text } of blocks) {
      const markup = text
        .replace(/{%-?\s*schema\s*-?%}[\s\S]*?{%-?\s*endschema\s*-?%}/g, "")
        .replace(/{%-?\s*comment\s*-?%}[\s\S]*?{%-?\s*endcomment\s*-?%}/g, "")
        .replace(/{%-?\s*doc\s*-?%}[\s\S]*?{%-?\s*enddoc\s*-?%}/g, "");
      expect(markup, name).not.toMatch(/SpareFit|Parts Finder/);
    }
  });
});
