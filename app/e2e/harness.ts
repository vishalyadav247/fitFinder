// End-to-end harness. Import it FIRST in an e2e test file: it sets the app's environment and puts
// the fake Shopify in front of `fetch` before @shopify/shopify-api captures fetch at import.
// Routes are then called the way React Router calls them (loader/action with a Request), with an
// App Bridge session token like the embedded admin sends, so authentication is the library's own.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  API_KEY,
  API_SECRET,
  APP_URL,
  FakeShopify,
  PARTNER,
  SCOPES,
  sessionToken,
} from "./fake-shopify";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env: rely on the environment
}

// The journeys create, uninstall and purge shops and run real jobs: a local database only (set
// E2E_ALLOW_REMOTE_DB=true to run against another one on purpose). No database fails the run
// instead of skipping it, so a green e2e run always means the journeys ran.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("The end-to-end tests need DATABASE_URL (a local Postgres).");
}
const dbHost = new URL(databaseUrl).hostname;
if (
  !["localhost", "127.0.0.1", "::1", "[::1]"].includes(dbHost) &&
  process.env.E2E_ALLOW_REMOTE_DB !== "true"
) {
  throw new Error(
    `The end-to-end tests only run against a local database (DATABASE_URL points at ${dbHost}).`,
  );
}

const TEMP_PREFIX = "fitfinder-e2e-";
export const storageDir = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX));

Object.assign(process.env, {
  SHOPIFY_API_KEY: API_KEY,
  SHOPIFY_API_SECRET: API_SECRET,
  SHOPIFY_APP_URL: APP_URL,
  SCOPES,
  STORAGE_DIR: storageDir,
  // Own pg-boss schema: a dev server on the same database must not take our jobs.
  PGBOSS_SCHEMA: "pgboss_e2e",
  JOBS_INLINE: "true",
  // No daily purge or sweep of every shop: they would act on the whole database.
  JOBS_SCHEDULES: "false",
  SHOPIFY_PARTNER_ORG_ID: PARTNER.orgId,
  SHOPIFY_PARTNER_API_ACCESS_TOKEN: PARTNER.token,
  SHOPIFY_APP_GID: PARTNER.appGid,
  SHOPIFY_APP_HANDLE: PARTNER.handle,
});
delete process.env.STORAGE_DRIVER;
delete process.env.SHOP_CUSTOM_DOMAIN;

export const shopify = new FakeShopify();
globalThis.fetch = shopify.fetch as typeof fetch;

// Response bodies are whatever the route sent; the tests read them like the admin's fetch does.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Result<T = any> {
  status: number;
  headers: Headers;
  body: T;
  /** Where a redirect points (Location, or App Bridge's reauthorize header). */
  location: string | null;
}

/** A loader or action of any route (the args are built like React Router's). */
type RouteFn = (args: never) => unknown;

async function normalize(value: unknown): Promise<Result> {
  if (value instanceof Response) {
    const type = value.headers.get("content-type") ?? "";
    const body = value.body
      ? type.includes("json")
        ? await value.json()
        : await value.text()
      : null;
    return {
      status: value.status,
      headers: value.headers,
      body,
      location:
        value.headers.get("location") ??
        value.headers.get("x-shopify-api-request-failure-reauthorize-url"),
    };
  }
  // react-router `data(value, init)`.
  if (
    value &&
    typeof value === "object" &&
    (value as { type?: string }).type === "DataWithResponseInit"
  ) {
    const d = value as { data: unknown; init: ResponseInit | null };
    return {
      status: d.init?.status ?? 200,
      headers: new Headers(d.init?.headers),
      body: d.data,
      location: null,
    };
  }
  return { status: 200, headers: new Headers(), body: value, location: null };
}

/** Runs a loader or action; a thrown Response (redirect, 4xx) is returned like a returned one. */
export async function run(
  fn: RouteFn,
  request: Request,
  params: Record<string, string> = {},
): Promise<Result> {
  try {
    const url = new URL(request.url);
    const args = { request, params, context: {}, url, pattern: url.pathname };
    return await normalize(await fn(args as never));
  } catch (error) {
    if (error instanceof Response) return normalize(error);
    throw error;
  }
}

type Body =
  | { form: Record<string, string> }
  | { json: unknown }
  | { raw: BodyInit; contentType?: string }
  | undefined;

/** A request from the embedded admin (App Bridge adds the session token to fetches). */
export function adminRequest(
  shop: string,
  pathAndQuery: string,
  { method = "GET", body }: { method?: string; body?: Body } = {},
) {
  const headers = new Headers({
    Authorization: `Bearer ${sessionToken(shop)}`,
  });
  let payload: BodyInit | undefined;
  if (body && "form" in body) {
    payload = new URLSearchParams(body.form);
    headers.set("Content-Type", "application/x-www-form-urlencoded");
  } else if (body && "json" in body) {
    payload = JSON.stringify(body.json);
    headers.set("Content-Type", "application/json");
  } else if (body && "raw" in body) {
    payload = body.raw;
    headers.set("Content-Type", body.contentType ?? "application/octet-stream");
  }
  return new Request(`${APP_URL}${pathAndQuery}`, {
    method,
    headers,
    body: payload,
    // Node's fetch Request needs this for streamed bodies.
    ...(payload ? { duplex: "half" } : {}),
  } as RequestInit);
}

/** Polls until `check` returns a truthy value (jobs run in pg-boss, polled every ~2 s). */
export async function waitFor<T>(
  what: string,
  check: () => Promise<T | null | undefined | false>,
  { timeoutMs = 45_000, everyMs = 250 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for ${what}${last ? `: ${String(last)}` : ""}`,
      );
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

/** Shop domains of the journeys: `e2e-{name}-{run}.myshopify.com`. */
export const E2E_DOMAIN = /^e2e-[a-z]+-[0-9a-f]{8}.myshopify.com$/;

/**
 * Leftovers of an interrupted run (Ctrl-C, crash): its shops and sessions, queued jobs in the
 * e2e pg-boss schema and temp folders. Call before the workers start.
 */
export async function cleanLeftovers() {
  const { default: prisma } = await import("../db.server");
  const shops = await prisma.shop.findMany({
    where: { domain: { startsWith: "e2e-", endsWith: ".myshopify.com" } },
    select: { domain: true },
  });
  const domains = shops.map((s) => s.domain).filter((d) => E2E_DOMAIN.test(d));
  if (domains.length) {
    await prisma.session.deleteMany({ where: { shop: { in: domains } } });
    await prisma.shop.deleteMany({ where: { domain: { in: domains } } });
  }
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS pgboss_e2e CASCADE`);
  for (const name of readdirSync(tmpdir())) {
    const dir = path.join(tmpdir(), name);
    if (name.startsWith(TEMP_PREFIX) && dir !== storageDir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

export async function stopJobs() {
  const boss = await global.fitfinderBoss?.catch(() => undefined);
  await boss?.stop({ graceful: false, timeout: 5000 }).catch(() => {});
  global.fitfinderBoss = undefined;
  global.fitfinderWorkers = undefined;
  const { default: prisma } = await import("../db.server");
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS pgboss_e2e CASCADE`);
}

export function removeStorage() {
  rmSync(storageDir, { recursive: true, force: true });
}
