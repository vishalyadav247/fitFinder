import { beforeEach, describe, expect, it } from "vitest";
import {
  limitState,
  MAX_RUNNING,
  resetLimits,
  SHOP_BURST,
  SHOP_RATE,
  takeToken,
  WAIT_MS,
  withQuerySlot,
} from "./limits.server";

beforeEach(() => resetLimits());

describe("per-shop request budget", () => {
  it("allows a burst, then refills at the shop rate", () => {
    const now = 1_000_000;
    for (let i = 0; i < SHOP_BURST; i++) expect(takeToken("a", now)).toBe(true);
    expect(takeToken("a", now)).toBe(false);
    // Other shops have their own budget.
    expect(takeToken("b", now)).toBe(true);
    // One second later: SHOP_RATE more.
    for (let i = 0; i < SHOP_RATE; i++) {
      expect(takeToken("a", now + 1000)).toBe(true);
    }
    expect(takeToken("a", now + 1000)).toBe(false);
  });
});

describe("storefront query slots", () => {
  it("runs at most MAX_RUNNING at once and hands slots to waiters", async () => {
    const gates: (() => void)[] = [];
    const runs = Array.from({ length: MAX_RUNNING + 3 }, () =>
      withQuerySlot(() => new Promise<void>((r) => gates.push(r))),
    );
    await Promise.resolve();
    expect(gates).toHaveLength(MAX_RUNNING);
    expect(limitState()).toEqual({ running: MAX_RUNNING, waiting: 3 });
    // Each finished query hands its slot to the next waiter.
    for (let i = 0; i < 3; i++) {
      gates[i]();
      await new Promise((r) => setTimeout(r, 0));
      expect(gates).toHaveLength(MAX_RUNNING + 1 + i);
      expect(limitState().running).toBe(MAX_RUNNING);
    }
    gates.forEach((g) => g());
    await Promise.all(runs);
    expect(limitState()).toEqual({ running: 0, waiting: 0 });
  });

  it("answers 503 when no slot frees up in time, and frees slots on errors", async () => {
    const block = Array.from({ length: MAX_RUNNING }, () =>
      withQuerySlot(() => new Promise((r) => setTimeout(r, WAIT_MS + 500))),
    );
    const late = withQuerySlot(async () => "never");
    await expect(late).rejects.toMatchObject({ status: 503 });
    await Promise.all(block);
    await expect(
      withQuerySlot(async () => {
        throw new Error("query failed");
      }),
    ).rejects.toThrow("query failed");
    expect(limitState()).toEqual({ running: 0, waiting: 0 });
  }, 10_000);
});
