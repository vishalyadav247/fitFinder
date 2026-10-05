import { describe, expect, it, vi } from "vitest";
import type { Shop } from "@prisma/client";

vi.mock("../db.server", () => ({ default: {} }));

import {
  ensureShop,
  markShopUninstalled,
  parseShopDomain,
  upsertShopOnInstall,
} from "./shop.server";

function shop(overrides: Partial<Shop> = {}): Shop {
  return {
    id: "shop_1",
    domain: "demo.myshopify.com",
    installedAt: new Date("2026-01-01"),
    uninstalledAt: null,
    lastAuthAt: new Date(),
    plan: "starter",
    trialEndsAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function fakeDb(existing: Shop | null, updated = 0) {
  return {
    shop: {
      findUnique: vi.fn().mockResolvedValue(existing),
      upsert: vi
        .fn()
        .mockImplementation(({ create }) => existing ?? shop(create)),
      updateMany: vi.fn().mockResolvedValue({ count: updated }),
      update: vi.fn().mockImplementation(({ data }) => shop(data)),
    },
  };
}

describe("parseShopDomain", () => {
  it("normalises case and whitespace", () => {
    expect(parseShopDomain(" Demo.MyShopify.com ", undefined)).toBe(
      "demo.myshopify.com",
    );
  });

  it.each([
    "",
    "evil.com",
    "a.myshopify.com.evil.com",
    "-demo.myshopify.com",
    "demo.myshopify.com.",
  ])("rejects %j", (domain) => {
    expect(() => parseShopDomain(domain, undefined)).toThrow();
  });

  it("accepts the configured custom shop domain only", () => {
    expect(parseShopDomain("Shop.Example.com", "shop.example.com")).toBe(
      "shop.example.com",
    );
    expect(() =>
      parseShopDomain("other.example.com", "shop.example.com"),
    ).toThrow();
  });
});

describe("upsertShopOnInstall", () => {
  it("upserts atomically, so a parallel first load can't hit a unique error", async () => {
    const db = fakeDb(null);
    await upsertShopOnInstall("demo.myshopify.com", db as never);
    expect(db.shop.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { domain: "demo.myshopify.com" },
        create: expect.objectContaining({ domain: "demo.myshopify.com" }),
        update: { lastAuthAt: expect.any(Date) },
      }),
    );
  });

  it("reactivates only shops marked uninstalled", async () => {
    const db = fakeDb(shop());
    await upsertShopOnInstall("demo.myshopify.com", db as never);
    expect(db.shop.updateMany).toHaveBeenCalledWith({
      where: { domain: "demo.myshopify.com", uninstalledAt: { not: null } },
      data: { uninstalledAt: null, installedAt: expect.any(Date) },
    });
  });
});

describe("ensureShop", () => {
  it("doesn't write for an active shop", async () => {
    const db = fakeDb(shop());
    const result = await ensureShop("demo.myshopify.com", db as never);
    expect(result.id).toBe("shop_1");
    expect(db.shop.upsert).not.toHaveBeenCalled();
    expect(db.shop.updateMany).not.toHaveBeenCalled();
  });

  it("refreshes a stale lastAuthAt", async () => {
    const db = fakeDb(shop({ lastAuthAt: new Date("2026-01-01") }));
    await ensureShop("demo.myshopify.com", db as never);
    expect(db.shop.update).toHaveBeenCalledWith({
      where: { id: "shop_1" },
      data: { lastAuthAt: expect.any(Date) },
    });
  });

  it("creates a missing shop row", async () => {
    const db = fakeDb(null);
    await ensureShop("demo.myshopify.com", db as never);
    expect(db.shop.upsert).toHaveBeenCalled();
  });
});

describe("markShopUninstalled", () => {
  it("only stamps a shop installed before the uninstall happened", async () => {
    const db = fakeDb(null, 1);
    const at = new Date("2026-03-01T10:00:00Z");
    expect(
      await markShopUninstalled("demo.myshopify.com", at, db as never),
    ).toBe(true);
    expect(db.shop.updateMany).toHaveBeenCalledWith({
      where: {
        domain: "demo.myshopify.com",
        uninstalledAt: null,
        lastAuthAt: { lte: at },
      },
      data: { uninstalledAt: at },
    });
  });

  it("returns false when nothing matched (unknown, already uninstalled or reinstalled)", async () => {
    const db = fakeDb(null, 0);
    expect(
      await markShopUninstalled("demo.myshopify.com", new Date(), db as never),
    ).toBe(false);
  });
});
