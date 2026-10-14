// Sign-in for the backoffice (/backoffice, specs/backoffice.md). One super admin:
// - First sign-in: the BACKOFFICE_EMAIL / BACKOFFICE_PASSWORD env values. Both must be set or the
//   backoffice doesn't exist (404).
// - After the admin saves the Profile page: the backoffice_admins row (password as a scrypt hash,
//   hashed here on the server). Its `version` goes up on an email or password change, which signs
//   out every other session.
// A signed cookie session (8 hours, SameSite=Strict), an Origin check on every form post, and a
// cap on failed sign-ins. The cookie key is derived on the server from the env values and the app
// secret; nothing else needs configuring.
import {
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import {
  createCookieSessionStorage,
  redirect,
  type SessionStorage,
} from "react-router";
import prisma from "../db.server";

const SESSION_HOURS = 8;
const LOGIN_PATH = "/backoffice/login";
import { MIN_PASSWORD } from "./backoffice-shared";

export { MIN_PASSWORD };

export interface BackofficeConfig {
  email: string;
  password: string;
  /** Cookie signing key (derived, never configured). */
  secret: string;
}

export function backofficeConfig(env = process.env): BackofficeConfig | null {
  const email = env.BACKOFFICE_EMAIL?.trim().toLowerCase();
  const password = env.BACKOFFICE_PASSWORD;
  if (!email || !password) return null;
  if (password.length < MIN_PASSWORD) {
    console.error(
      `backoffice: BACKOFFICE_PASSWORD must be at least ${MIN_PASSWORD} characters; the backoffice is off.`,
    );
    return null;
  }
  const secret = createHmac(
    "sha256",
    env.SHOPIFY_API_SECRET || "sparefit-backoffice",
  )
    .update(`backoffice-session\n${email}\n${password}`)
    .digest("hex");
  return { email, password, secret };
}

/** Compares two strings in constant time (hashed first, so lengths don't leak either). */
export function sameText(a: string, b: string) {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

// ---------------------------------------------------------------- passwords (scrypt)

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const derive = (password: string, salt: Buffer, keylen = SCRYPT.keylen) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      keylen,
      { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );

/** "scrypt:salt:hash" (base64). */
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt:${salt.toString("base64")}:${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [kind, saltB64, hashB64] = stored.split(":");
  if (kind !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  if (!expected.length) return false;
  const key = await derive(
    password,
    Buffer.from(saltB64, "base64"),
    expected.length,
  );
  return timingSafeEqual(key, expected);
}

// ---------------------------------------------------------------- the admin

export interface Admin {
  name: string;
  email: string;
  version: number;
  /** "env": nothing saved yet, the env values sign in. */
  source: "db" | "env";
}

export async function getAdmin(config = requireConfig()): Promise<Admin> {
  const row = await prisma.backofficeAdmin.findUnique({ where: { id: 1 } });
  return row
    ? { name: row.name, email: row.email, version: row.version, source: "db" }
    : { name: "", email: config.email, version: 0, source: "env" };
}

/** The admin when the email and password are right, else null (both checks always run). */
export async function checkCredentials(
  email: string,
  password: string,
): Promise<Admin | null> {
  const config = requireConfig();
  const row = await prisma.backofficeAdmin.findUnique({ where: { id: 1 } });
  const wanted = (email || "").trim().toLowerCase();
  if (row) {
    const okEmail = sameText(wanted, row.email);
    const okPassword = await verifyPassword(password, row.passwordHash);
    return okEmail && okPassword
      ? { name: row.name, email: row.email, version: row.version, source: "db" }
      : null;
  }
  const okEmail = sameText(wanted, config.email);
  const okPassword = sameText(password, config.password);
  return okEmail && okPassword
    ? { name: "", email: config.email, version: 0, source: "env" }
    : null;
}

export class ProfileError extends Error {
  constructor(
    message: string,
    readonly field: "currentPassword" | "newPassword" | "email" | "name",
  ) {
    super(message);
  }
}

/**
 * Saves the profile. The current password is always required. Changing the email or password
 * raises `version` (other sessions are signed out); the caller starts a fresh session.
 */
export async function updateProfile(input: {
  name: string;
  email: string;
  currentPassword: string;
  newPassword: string;
}): Promise<Admin> {
  const current = await getAdmin();
  const ok = await checkCredentials(current.email, input.currentPassword);
  if (!ok) {
    throw new ProfileError(
      "Your current password is wrong.",
      "currentPassword",
    );
  }
  if (input.newPassword && input.newPassword.length < MIN_PASSWORD) {
    throw new ProfileError(
      `Use at least ${MIN_PASSWORD} characters.`,
      "newPassword",
    );
  }
  const email = input.email.trim().toLowerCase();
  const changed = email !== current.email || !!input.newPassword;
  const passwordHash = await hashPassword(
    input.newPassword || input.currentPassword,
  );
  const row = await prisma.backofficeAdmin.upsert({
    where: { id: 1 },
    create: { id: 1, name: input.name.trim(), email, passwordHash, version: 1 },
    update: {
      name: input.name.trim(),
      email,
      ...(input.newPassword ? { passwordHash } : {}),
      ...(changed ? { version: { increment: 1 } } : {}),
    },
  });
  return {
    name: row.name,
    email: row.email,
    version: row.version,
    source: "db",
  };
}

// ---------------------------------------------------------------- session

type SessionData = { email: string; at: string; ver: string };
let storage: SessionStorage<SessionData> | null = null;
let storageSecret = "";

function sessions(config: BackofficeConfig) {
  if (!storage || storageSecret !== config.secret) {
    storage = createCookieSessionStorage<SessionData>({
      cookie: {
        name: "__sparefit_bo",
        httpOnly: true,
        // eslint-disable-next-line no-undef
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        // "/" and not "/backoffice": React Router loads page data from /backoffice.data, which a
        // cookie scoped to /backoffice doesn't cover (sign-in and save then loop forever).
        path: "/",
        maxAge: SESSION_HOURS * 3600,
        secrets: [config.secret],
      },
    });
    storageSecret = config.secret;
  }
  return storage;
}

const notFound = () => new Response("Not Found", { status: 404 });

/** The config, or a 404 when the backoffice isn't set up in this environment. */
export function requireConfig() {
  const config = backofficeConfig();
  if (!config) throw notFound();
  return config;
}

/** The signed-in super admin; otherwise redirects to the sign-in page. */
export async function requireAdmin(request: Request): Promise<Admin> {
  const config = requireConfig();
  const session = await sessions(config).getSession(
    request.headers.get("Cookie"),
  );
  const email = session.get("email");
  const at = Number(session.get("at"));
  const ver = Number(session.get("ver") ?? 0);
  const admin = await getAdmin(config);
  if (
    typeof email !== "string" ||
    email !== admin.email ||
    ver !== admin.version ||
    !(Date.now() - at < SESSION_HOURS * 3600_000)
  ) {
    throw redirect(LOGIN_PATH);
  }
  return admin;
}

export async function signedIn(request: Request) {
  try {
    await requireAdmin(request);
    return true;
  } catch {
    return false;
  }
}

/** A fresh session for `admin`, redirecting to `to` (with extra headers, e.g. none). */
export async function startSession(
  request: Request,
  admin: Pick<Admin, "email" | "version">,
  to = "/backoffice",
) {
  const store = sessions(requireConfig());
  const session = await store.getSession(request.headers.get("Cookie"));
  session.set("email", admin.email);
  session.set("at", String(Date.now()));
  session.set("ver", String(admin.version));
  return redirect(to, {
    headers: { "Set-Cookie": await store.commitSession(session) },
  });
}

export async function endSession(request: Request) {
  const store = sessions(requireConfig());
  const session = await store.getSession(request.headers.get("Cookie"));
  return redirect(LOGIN_PATH, {
    headers: { "Set-Cookie": await store.destroySession(session) },
  });
}

/**
 * Form posts must come from this site (CSRF): the Origin header must match the request's own
 * origin. Browsers send Origin on every POST; a missing one is refused.
 */
export function checkOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const host =
    request.headers.get("X-Forwarded-Host") ??
    request.headers.get("Host") ??
    url.host;
  let ok = false;
  try {
    ok =
      !!origin &&
      (new URL(origin).host === host || new URL(origin).host === url.host);
  } catch {
    ok = false;
  }
  if (!ok) throw new Response("Forbidden", { status: 403 });
}

// ---------------------------------------------------------------- failed sign-ins

const MAX_FAILURES = 5;
// All IPs together: X-Forwarded-For can be made up, so a guesser changing it still hits this.
const MAX_FAILURES_ALL = 50;
const ALL = "*";
const WINDOW_MS = 15 * 60_000;
const MAX_TRACKED = 10_000;
const failures = new Map<string, { count: number; since: number }>();

export function clientIp(request: Request) {
  return (
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    request.headers.get("X-Real-IP") ||
    "unknown"
  );
}

function used(key: string, now: number) {
  const f = failures.get(key);
  if (!f) return 0;
  if (now - f.since > WINDOW_MS) {
    failures.delete(key);
    return 0;
  }
  return f.count;
}

/** True while sign-ins are blocked: 5 failures per IP, or 50 in all, per 15 minutes. */
export function isLockedOut(ip: string, now = Date.now()) {
  return used(ip, now) >= MAX_FAILURES || used(ALL, now) >= MAX_FAILURES_ALL;
}

export function recordFailure(ip: string, now = Date.now()) {
  for (const key of [ip, ALL]) {
    const f = failures.get(key);
    if (!f || now - f.since > WINDOW_MS) {
      if (failures.size >= MAX_TRACKED)
        failures.delete(failures.keys().next().value!);
      failures.set(key, { count: 1, since: now });
    } else {
      f.count += 1;
    }
  }
}

export function clearFailures(ip?: string) {
  if (ip) failures.delete(ip);
  else failures.clear();
}

/**
 * Starts a sign-in attempt: counted as a failure right away (before any await), so parallel
 * posts can't all pass the lockout check while their password checks run. False when locked
 * out. A successful sign-in calls clearFailures(ip).
 */
export function startAttempt(ip: string, now = Date.now()) {
  if (isLockedOut(ip, now)) return false;
  recordFailure(ip, now);
  return true;
}
