// Protects the public app proxy (anyone can call /apps/fitfinder/* on a store): a request budget
// per shop, and a cap on storefront queries running at once in this process, so one busy (or
// abused) store can't take every database connection from the others. Over the budget: 429;
// no free slot within a few seconds: 503 (the storefront scripts keep what they show).
import { json } from "./proxy-response";

const envNumber = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Per shop and process. Every shopper and bot of a store shares it (all traffic comes through
// Shopify's proxy), so it sits well above a busy store's real peak; set PROXY_SHOP_RATE /
// PROXY_SHOP_BURST to change it without a code change.
export const SHOP_RATE = envNumber("PROXY_SHOP_RATE", 100);
export const SHOP_BURST = envNumber("PROXY_SHOP_BURST", 300);
const MAX_TRACKED_SHOPS = 10_000;

// Must stay below the database pool (Prisma: connection_limit in DATABASE_URL), so admin pages
// and jobs always find a connection. PROXY_MAX_QUERIES to change.
export const MAX_RUNNING = envNumber("PROXY_MAX_QUERIES", 8);
export const MAX_WAITING = 200;
export const WAIT_MS = 3000;

interface Bucket {
  tokens: number;
  at: number;
}

const buckets = new Map<string, Bucket>();

/** Takes one request from the shop's budget; false when it is used up. */
export function takeToken(shop: string, now = Date.now()): boolean {
  let bucket = buckets.get(shop);
  if (bucket) {
    buckets.delete(shop); // re-inserted below: the Map keeps the most recent last
    bucket.tokens = Math.min(
      SHOP_BURST,
      bucket.tokens + ((now - bucket.at) / 1000) * SHOP_RATE,
    );
    bucket.at = now;
  } else {
    bucket = { tokens: SHOP_BURST, at: now };
  }
  buckets.set(shop, bucket);
  if (buckets.size > MAX_TRACKED_SHOPS) {
    buckets.delete(buckets.keys().next().value!);
  }
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

const warnedAt = new Map<string, number>();

/** Throws a 429 response when the shop is over its budget (and says so in the log, once a minute). */
export function checkShopRate(shop: string, now = Date.now()) {
  if (takeToken(shop, now)) return;
  if (now - (warnedAt.get(shop) ?? 0) > 60_000) {
    warnedAt.set(shop, now);
    if (warnedAt.size > MAX_TRACKED_SHOPS) warnedAt.clear();
    console.warn("proxy: shop over its request budget (429)", { shop });
  }
  throw json({ error: "rate_limited" }, 429, 0, { "Retry-After": "1" });
}

let running = 0;
const waiting: (() => void)[] = [];

function release() {
  const next = waiting.shift();
  if (next) next();
  else running--;
}

/**
 * Runs a storefront query once one of MAX_RUNNING slots is free. Waits at most WAIT_MS (and
 * refuses when MAX_WAITING are queued already): then a 503 response is thrown.
 */
export async function withQuerySlot<T>(work: () => Promise<T>): Promise<T> {
  if (running < MAX_RUNNING) {
    running++;
  } else {
    if (waiting.length >= MAX_WAITING) throw busy();
    await new Promise<void>((resolve, reject) => {
      const turn = () => {
        clearTimeout(timer);
        resolve(); // the slot passes straight to us; `running` stays the same
      };
      const timer = setTimeout(() => {
        const i = waiting.indexOf(turn);
        if (i >= 0) waiting.splice(i, 1);
        reject(busy());
      }, WAIT_MS);
      waiting.push(turn);
    });
  }
  try {
    return await work();
  } catch (error) {
    // The database pool was full after all (Prisma: no connection / transaction start timeout).
    const code = (error as { code?: string } | null)?.code;
    if (code === "P2024" || code === "P2028") throw busy();
    throw error;
  } finally {
    release();
  }
}

const busy = () => json({ error: "busy" }, 503, 0, { "Retry-After": "2" });

/** For tests. */
export function resetLimits() {
  buckets.clear();
  warnedAt.clear();
  running = 0;
  waiting.length = 0;
}

export const limitState = () => ({ running, waiting: waiting.length });
