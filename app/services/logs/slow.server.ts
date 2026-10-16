// Backoffice › Logs › Slow requests: the root route's middleware times every request (pages,
// data requests, API, app proxy, webhooks) and logs the ones slower than LOG_SLOW_MS (default
// 3 s) as "slow" entries, grouped by method and path. Uploads and downloads of big files are
// left out: they are slow because of their size.
import { isbot } from "isbot";
import type { MiddlewareFunction } from "react-router";
import { fingerprint, redact, type LogEntry } from "./entry";
import { recordLog } from "./logs.server";

export const SLOW_MS = Number(process.env.LOG_SLOW_MS) || 3000;

const SKIP = [
  /^\/api\/uploads/,
  /^\/api\/fitment\/export/,
  /^\/api\/imports\/[^/]+\/file/,
  /^\/assets\//,
];

const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
// Routes that check who is calling (admin session, app proxy signature, webhook HMAC): only
// their successful requests name a shop, so public pages can't pin entries on any shop.
const VERIFIED = /^\/(?:app|api|proxy|webhooks)(?:\/|$)/;

/**
 * The shop of a request: the `shop` parameter (admin pages, app proxy), the webhook header, or
 * the session token's `dest` (admin fetches). Not verified here: slowEntry uses it only for
 * successful requests to routes that verified it.
 */
export function requestShop(request: Request): string | null {
  const url = new URL(request.url);
  const param = url.searchParams.get("shop");
  if (param && SHOP.test(param)) return param;
  const header = request.headers.get("x-shopify-shop-domain");
  if (header && SHOP.test(header)) return header;
  const token = /^Bearer\s+([^.]+)\.([^.]+)\./i.exec(
    request.headers.get("authorization") ?? "",
  )?.[2];
  if (token) {
    try {
      const dest = JSON.parse(Buffer.from(token, "base64url").toString()).dest;
      const host = typeof dest === "string" ? new URL(dest).hostname : "";
      if (SHOP.test(host)) return host;
    } catch {
      // not a session token
    }
  }
  return null;
}

/** "/app/filter-data.data" → "/app/filter-data" (React Router data requests). */
export const routePath = (pathname: string) =>
  pathname.replace(/\.data$/, "").replace(/\/_root$/, "/") || "/";

export function slowEntry(
  request: Request,
  status: number,
  durationMs: number,
): LogEntry | null {
  const path = routePath(new URL(request.url).pathname);
  if (durationMs < SLOW_MS || SKIP.some((re) => re.test(path))) return null;
  const message = `Slow request: ${request.method} ${redact(path)}`;
  const shopDomain =
    status >= 200 && status < 300 && VERIFIED.test(path)
      ? requestShop(request)
      : null;
  const entry = {
    level: "slow" as const,
    source: "request",
    message,
    detail: `${(durationMs / 1000).toFixed(1)} s, status ${status}`,
    shopDomain,
    path: redact(path),
    durationMs: Math.round(durationMs),
  };
  return { ...entry, fingerprint: fingerprint(entry) };
}

export const timeRequests: MiddlewareFunction<Response> = async (
  { request },
  next,
) => {
  const started = performance.now();
  const response = await next();
  // Bots get the whole page rendered before the response (onAllReady): slow by design.
  if (isbot(request.headers.get("user-agent") ?? "")) return response;
  try {
    const entry = slowEntry(
      request,
      response.status,
      performance.now() - started,
    );
    if (entry) recordLog(entry);
  } catch {
    // timing never breaks a request
  }
  return response;
};
