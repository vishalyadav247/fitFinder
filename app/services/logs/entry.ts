// Backoffice › Logs: turns what the app passes to console.error / console.warn into one log entry
// (specs/backoffice.md › Logs). Secrets and email addresses are removed before anything is
// stored, and long texts are cut. Pure, so it is unit tested without a database.
import { createHash } from "node:crypto";

export type LogLevel = "error" | "warn" | "slow";

export interface LogEntry {
  level: LogLevel;
  source: string;
  message: string;
  detail: string | null;
  shopDomain: string | null;
  path: string | null;
  durationMs: number | null;
  fingerprint: string;
  /** Logged as `shopId` only: the domain is looked up when the entry is written. Not stored. */
  shopId?: string | null;
}

export const MAX_MESSAGE = 500;
export const MAX_DETAIL = 8000;

const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const SHOP_KEYS = ["shop", "shopDomain", "shop_domain", "domain"];

// Keys whose values are secret or personal, in JSON (also escaped JSON: \"key\":\"value\"),
// headers and key=value text. `\w*` around secret/password/token also catches prefixed names
// (client_secret, SHOPIFY_API_SECRET, refresh_token).
const SECRET_KEY =
  /((?:\\?")?\b\w*(?:secret|passw\w*|token)\w*(?:\\?")?|(?:\\?")?\b(?:api_?key|authorization|signature|hmac|ip|customer_?id|logged_in_customer_id)(?:\\?")?)(\s*[:=]\s*)(\\?"(?:[^"\\]|\\(?!")|\\(?="))*?\\?"|[^\s,&;}]+)/gi;

/**
 * Removes access tokens, session tokens, passwords, secrets, cookies, signatures, URL
 * credentials, shopper ids, IP addresses and email addresses. Error codes (Prisma "code: P2002")
 * stay readable; OAuth codes and sessions are only removed as URL parameters.
 */
export function redact(text: string): string {
  return (
    text
      // Shopify access / refresh tokens and app secrets.
      .replace(/\bshp(?:at|ca|pa|ss|rt|ua)_[A-Za-z0-9]+/g, "[redacted token]")
      // JWTs (App Bridge session tokens) and bearer values.
      .replace(
        /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
        "[redacted token]",
      )
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
      // Credentials in URLs: postgres://user:pass@host, https://user:pass@…
      .replace(
        /\b([a-z][a-z0-9+.-]*:\/\/)[^:@\s/]+:[^@\s/]+@/gi,
        "$1[redacted]@",
      )
      // Whole cookie headers (several name=value pairs).
      .replace(/(\b(?:set-)?cookie\\?"?\s*[:=]\s*)[^\n]*/gi, '$1"[redacted]"')
      // Sensitive URL parameters.
      .replace(
        /([?&](?:code|session|state|id_token|hmac|signature|logged_in_customer_id|timestamp)=)[^&\s"'\\]*/gi,
        "$1[redacted]",
      )
      .replace(SECRET_KEY, '$1$2"[redacted]"')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
      // IP addresses (v4, and v6 with at least three groups).
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]")
      .replace(/\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi, "[ip]")
  );
}

/** Terminal colour codes (dev server output): not part of the message. */
const ANSI =
  // eslint-disable-next-line no-control-regex
  /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
export const plainText = (text: string) => text.replace(ANSI, "");

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

function errorText(error: Error): string {
  const parts = [error.stack || `${error.name}: ${error.message}`];
  // Prisma errors carry their code and meta; other errors may have a cause.
  const extra = error as Error & { code?: unknown; meta?: unknown };
  if (extra.code !== undefined) parts.push(`code: ${String(extra.code)}`);
  if (extra.meta !== undefined) parts.push(`meta: ${safeJson(extra.meta)}`);
  if (error.cause instanceof Error)
    parts.push(`cause: ${errorText(error.cause)}`);
  return parts.join("\n");
}

/** JSON that survives cycles, BigInt, Errors and Responses. */
function safeJson(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_key, v: unknown) => {
        if (typeof v === "bigint") return v.toString();
        if (v instanceof Error) return errorText(v);
        if (typeof Response !== "undefined" && v instanceof Response) {
          return `Response ${v.status} ${v.statusText}`.trim();
        }
        if (v && typeof v === "object") {
          if (seen.has(v)) return "[circular]";
          seen.add(v);
        }
        return v;
      },
      2,
    );
  } catch {
    return String(value);
  }
}

/** The first shop domain found in the arguments (top level or one level into objects). */
function findShop(args: unknown[]): string | null {
  for (const arg of args) {
    if (typeof arg === "string" && SHOP.test(arg)) return arg;
    if (arg && typeof arg === "object" && !(arg instanceof Error)) {
      for (const key of SHOP_KEYS) {
        const v = (arg as Record<string, unknown>)[key];
        if (typeof v === "string" && SHOP.test(v)) return v;
      }
    }
  }
  return null;
}

function findValue(args: unknown[], key: string): unknown {
  for (const arg of args) {
    if (arg && typeof arg === "object" && !(arg instanceof Error)) {
      const v = (arg as Record<string, unknown>)[key];
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

/** Same level, source, message (numbers ignored) and shop → the same entry. */
export function fingerprint(
  e: Pick<LogEntry, "level" | "source" | "message" | "shopDomain"> & {
    shopId?: string | null;
    path?: string | null;
    /** The error's type and first line: different errors at one log call stay apart. */
    error?: string | null;
  },
) {
  const digits = (t: string) => t.replace(/\d+/g, "#");
  return createHash("sha1")
    .update(
      [
        e.level,
        e.source,
        digits(e.message),
        e.shopDomain ?? e.shopId ?? "",
        e.path ?? "",
        digits(e.error ?? ""),
      ].join("\n"),
    )
    .digest("hex");
}

/** "TypeError: x is undefined" of the first Error among the arguments (first line only). */
function errorKey(args: unknown[]): string | null {
  for (const arg of args) {
    const error =
      arg instanceof Error
        ? arg
        : arg && typeof arg === "object"
          ? Object.values(arg as Record<string, unknown>).find(
              (v): v is Error => v instanceof Error,
            )
          : undefined;
    if (error) {
      return redact(`${error.name}: ${error.message.split("\n")[0]}`).slice(
        0,
        300,
      );
    }
  }
  return null;
}

/**
 * One entry from a console.error / console.warn call, e.g.
 * `console.error("storefront: icon upload failed", { shop, error })` → source "storefront",
 * that message, the shop, and the error's stack as the detail.
 */
export function entryFromConsole(
  level: "error" | "warn",
  args: unknown[],
): LogEntry {
  const [first, ...rest] = args;
  let message: string;
  let details: unknown[];
  if (first instanceof Error) {
    message = `${first.name}: ${first.message}`;
    details = args;
  } else if (typeof first === "string") {
    message = first;
    details = rest;
  } else {
    message = safeJson(first);
    details = rest;
  }
  message = cut(
    redact(plainText(message).trim() || "(no message)"),
    MAX_MESSAGE,
  );
  // "area: what happened" → the area is the source.
  const area = /^([a-z][\w./ -]{0,38}?):\s/i.exec(message)?.[1];
  const source = area ? area.toLowerCase() : "app";

  const detailText = details
    .map((d) =>
      d instanceof Error
        ? errorText(d)
        : typeof d === "string"
          ? d
          : safeJson(d),
    )
    .filter(Boolean)
    .join("\n");
  const path = findValue(args, "path");
  const duration = findValue(args, "durationMs");
  const shopId = findValue(args, "shopId");
  const entry = {
    level,
    source,
    message,
    detail: detailText ? cut(redact(plainText(detailText)), MAX_DETAIL) : null,
    shopDomain: findShop(args),
    path: typeof path === "string" ? cut(redact(path), 300) : null,
    durationMs: typeof duration === "number" ? Math.round(duration) : null,
    shopId: typeof shopId === "string" && shopId.length <= 40 ? shopId : null,
  };
  return {
    ...entry,
    fingerprint: fingerprint({ ...entry, error: errorKey(args) }),
  };
}

/** Console noise that isn't about the app (dev server and framework notices). */
const IGNORED = [
  /^⚠️\s*Future Flag Warning/,
  /^\[vite\]/,
  /^\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?\s*\[vite\]/, // vite's timestamped errors
  /^\s*You can use the `future\./,
];

export const ignored = (args: unknown[]) =>
  typeof args[0] === "string" &&
  IGNORED.some((re) => re.test(plainText(args[0] as string)));
