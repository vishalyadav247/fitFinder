import { describe, expect, it } from "vitest";
import {
  backofficeConfig,
  checkOrigin,
  clearFailures,
  isLockedOut,
  recordFailure,
  sameText,
  startAttempt,
  startSession,
} from "./backoffice-auth.server";

describe("backoffice sign-in", () => {
  it("needs the email and a password of 12+ characters", () => {
    expect(backofficeConfig({})).toBeNull();
    expect(
      backofficeConfig({
        BACKOFFICE_EMAIL: "a@b.c",
        BACKOFFICE_PASSWORD: "short",
      }),
    ).toBeNull();
    const config = backofficeConfig({
      BACKOFFICE_EMAIL: " Admin@Example.com ",
      BACKOFFICE_PASSWORD: "correct horse battery",
      SHOPIFY_API_SECRET: "app-secret",
    });
    expect(config).toMatchObject({
      email: "admin@example.com",
      password: "correct horse battery",
    });
    expect(config!.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("derives a stable cookie key that changes with the password", () => {
    const env = {
      BACKOFFICE_EMAIL: "a@b.c",
      BACKOFFICE_PASSWORD: "correct horse battery",
      SHOPIFY_API_SECRET: "app-secret",
    };
    expect(backofficeConfig(env)!.secret).toBe(backofficeConfig(env)!.secret);
    expect(
      backofficeConfig({
        ...env,
        BACKOFFICE_PASSWORD: "another long password",
      })!.secret,
    ).not.toBe(backofficeConfig(env)!.secret);
  });

  it("compares passwords exactly", () => {
    expect(sameText("correct horse battery", "correct horse battery")).toBe(
      true,
    );
    expect(sameText("correct horse battery", "correct horse batter")).toBe(
      false,
    );
  });

  it("compares emails exactly", () => {
    expect(sameText("a@b.c", "a@b.c")).toBe(true);
    expect(sameText("a@b.c", "a@b.cd")).toBe(false);
  });

  it("locks an IP out after 5 failures for 15 minutes, and all IPs after 50", () => {
    clearFailures();
    const now = 1_000_000;
    for (let i = 0; i < 4; i++) recordFailure("1.1.1.1", now);
    expect(isLockedOut("1.1.1.1", now)).toBe(false);
    recordFailure("1.1.1.1", now);
    expect(isLockedOut("1.1.1.1", now)).toBe(true);
    expect(isLockedOut("2.2.2.2", now)).toBe(false);
    expect(isLockedOut("1.1.1.1", now + 16 * 60_000)).toBe(false);

    clearFailures();
    for (let i = 0; i < 50; i++) recordFailure(`10.0.0.${i}`, now);
    expect(isLockedOut("9.9.9.9", now)).toBe(true);
    clearFailures();
  });

  it("counts an attempt before the password check, so parallel guesses stop at 5", () => {
    clearFailures();
    const now = 2_000_000;
    const started = Array.from({ length: 20 }, () =>
      startAttempt("3.3.3.3", now),
    );
    expect(started.filter(Boolean)).toHaveLength(5);
    clearFailures();
  });

  it("sets the session cookie for the whole site, so /backoffice.data requests carry it", async () => {
    const before = { ...process.env };
    process.env.BACKOFFICE_EMAIL = "a@b.c";
    process.env.BACKOFFICE_PASSWORD = "correct horse battery";
    try {
      const res = await startSession(
        new Request("https://app.example.com/backoffice/login"),
        { email: "a@b.c", version: 0 },
      );
      const cookie = res.headers.get("Set-Cookie") ?? "";
      expect(cookie).toMatch(/^__sparefit_bo=/);
      expect(cookie).toContain("Path=/;");
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(res.headers.get("Location")).toBe("/backoffice");
    } finally {
      process.env = before;
    }
  });

  it("refuses form posts from another origin", () => {
    const post = (origin: string | null) =>
      new Request("https://app.example.com/backoffice/login", {
        method: "POST",
        headers: origin
          ? { Origin: origin, Host: "app.example.com" }
          : { Host: "app.example.com" },
      });
    expect(() => checkOrigin(post("https://app.example.com"))).not.toThrow();
    expect(() => checkOrigin(post("https://evil.example"))).toThrow();
    expect(() => checkOrigin(post(null))).toThrow();
  });
});
