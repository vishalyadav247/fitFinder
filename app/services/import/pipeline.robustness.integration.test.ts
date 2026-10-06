// Races and edge cases of the import pipeline, against the real Postgres in DATABASE_URL.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ImportMode } from "@prisma/client";
import prisma from "../../db.server";
import { upsertShopOnInstall } from "../../models/shop.server";
import { applyStoreType } from "../../models/search-config.server";
import {
  LocalStorage,
  keyBelongsToShop,
  newUploadKey,
  setStorageForTests,
  storage,
} from "../storage.server";
import {
  ImportError,
  QUEUE_STALE_MS,
  STALE_MS,
  cancelImport,
  createImport,
  runImport,
  runPreview,
  saveMapping,
  startRun,
  sweepStale,
} from "./pipeline.server";
import { csvCell } from "../fitment/rows";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env: rely on the environment
}

const DOMAIN = "vitest-import-robust.myshopify.com";
const CSV = "Make,Year,Model,SKU\nAUDI,2008-2011,A6,S1\nBMW,2016-,3 GT,S2\n";

class FailingDeleteStorage extends LocalStorage {
  failDeletes = false;
  async delete(key: string) {
    if (this.failDeletes) throw new Error("storage down");
    return super.delete(key);
  }
}

describe("csvCell", () => {
  it("quotes and neutralises formula-like cells", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell("AUDI")).toBe("AUDI");
  });
});

describe("keyBelongsToShop", () => {
  it("rejects other shops and path tricks", () => {
    expect(keyBelongsToShop("imports/s1/u/f.csv", "s1")).toBe(true);
    expect(keyBelongsToShop("imports/s2/u/f.csv", "s1")).toBe(false);
    expect(keyBelongsToShop("imports/s1/../s2/f.csv", "s1")).toBe(false);
    expect(keyBelongsToShop("imports/s1//f.csv", "s1")).toBe(false);
  });
});

describe.skipIf(!process.env.DATABASE_URL)(
  "import pipeline races (Postgres)",
  () => {
    let dir: string;
    let shopId: string;
    let store: FailingDeleteStorage;

    beforeAll(async () => {
      dir = await mkdtemp(path.join(os.tmpdir(), "ff-robust-"));
      store = new FailingDeleteStorage(dir);
      setStorageForTests(store);
    });

    afterAll(async () => {
      await prisma.shop.deleteMany({ where: { domain: DOMAIN } });
      setStorageForTests(undefined);
      await rm(dir, { recursive: true, force: true });
    });

    beforeEach(async () => {
      store.failDeletes = false;
      await prisma.shop.deleteMany({ where: { domain: DOMAIN } });
      shopId = (await upsertShopOnInstall(DOMAIN)).id;
      // Big files, not plan limits (billing.integration.test.ts covers those).
      await prisma.shop.update({
        where: { id: shopId },
        data: { plan: "pro" },
      });
      await applyStoreType(shopId, "automotive", { replace: false });
    });

    async function draft(body: string | Buffer, mode: ImportMode = "upsert") {
      const key = newUploadKey(shopId, "data.csv");
      await storage().put(
        key,
        typeof body === "string" ? Buffer.from(body) : body,
      );
      return createImport(shopId, { key, fileName: "data.csv", mode });
    }

    async function ready(body: string | Buffer, mode: ImportMode = "upsert") {
      const { job, choices } = await draft(body, mode);
      await saveMapping(shopId, job.id, {
        choices,
        hasHeader: true,
        lookForSkus: true,
        mode,
      });
      await runPreview(job.id);
      return prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
    }

    const job = (id: string) =>
      prisma.importJob.findUniqueOrThrow({ where: { id } });

    it("cancel after start can't touch a running import", async () => {
      const j = await ready(CSV);
      await startRun(shopId, j.id);
      await expect(cancelImport(shopId, j.id)).rejects.toBeInstanceOf(
        ImportError,
      );
      await runImport(j.id);
      expect((await job(j.id)).status).toBe("completed");
      expect(await prisma.fitmentRow.count({ where: { shopId } })).toBe(2);
    });

    it("start after cancel is refused", async () => {
      const j = await ready(CSV);
      await cancelImport(shopId, j.id);
      await expect(startRun(shopId, j.id)).rejects.toThrow("isn't ready");
      expect(await prisma.importRow.count({ where: { jobId: j.id } })).toBe(0);
    });

    it("a double Map click queues one check run", async () => {
      const { job: j, choices } = await draft(CSV);
      const input = {
        choices,
        hasHeader: true,
        lookForSkus: true,
        mode: "upsert" as const,
      };
      const results = await Promise.allSettled([
        saveMapping(shopId, j.id, input),
        saveMapping(shopId, j.id, input),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      await runPreview(j.id);
      expect((await job(j.id)).added).toBe(2);
    });

    it("cancel during the check run leaves no staging rows", async () => {
      const big =
        "Make,Year,Model,SKU\n" +
        Array.from({ length: 60_000 }, (_, i) => `M${i},2016,X,S${i}`).join(
          "\n",
        );
      const { job: j, choices } = await draft(big);
      await saveMapping(shopId, j.id, {
        choices,
        hasHeader: true,
        lookForSkus: true,
        mode: "upsert",
      });
      const running = runPreview(j.id);
      // Wait until the first batch is in, then cancel.
      for (let i = 0; i < 200; i++) {
        if ((await job(j.id)).processedRows > 0) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      await cancelImport(shopId, j.id);
      await running;
      expect((await job(j.id)).status).toBe("cancelled");
      expect(await prisma.importRow.count({ where: { jobId: j.id } })).toBe(0);
    });

    const ageJob = (id: string, ms: number, claimed: boolean) =>
      prisma.$executeRaw`
        UPDATE import_jobs
        SET updated_at = now() - ${`${Math.round(ms / 1000)} seconds`}::interval,
            claimed_at = ${claimed ? new Date() : null}
        WHERE id = ${id}`;

    it("a claimed job whose worker died stops locking the shop", async () => {
      const j = await ready(CSV);
      await startRun(shopId, j.id);
      await ageJob(j.id, STALE_MS + 60_000, true); // claimed, then silent
      const next = await draft(CSV);
      expect(next.job.status).toBe("uploaded");
      const old = await job(j.id);
      // Marked failed by the sweep, then cleaned up (file deleted) by the new import.
      expect(old.status).toBe("cancelled");
      expect(old.failureReason).toContain("stopped unexpectedly");
    });

    it("a job waiting in the queue behind other imports is not swept", async () => {
      const j = await ready(CSV);
      const attempt = await startRun(shopId, j.id);
      await ageJob(j.id, STALE_MS + 60_000, false); // queued, not claimed
      await sweepStale(shopId);
      expect((await job(j.id)).status).toBe("running");
      await runImport(j.id, attempt);
      expect((await job(j.id)).status).toBe("completed");
      expect(await prisma.fitmentRow.count({ where: { shopId } })).toBe(2);
    });

    it("an unclaimed job past the queue expiry is swept", async () => {
      const j = await ready(CSV);
      await startRun(shopId, j.id);
      await ageJob(j.id, QUEUE_STALE_MS + 60_000, false);
      await sweepStale(shopId);
      expect((await job(j.id)).status).toBe("failed");
    });

    it("duplicate or outdated queue messages do nothing", async () => {
      const { job: j, choices } = await draft(CSV);
      const attempt = await saveMapping(shopId, j.id, {
        choices,
        hasHeader: true,
        lookForSkus: true,
        mode: "upsert",
      });
      await Promise.all([runPreview(j.id, attempt), runPreview(j.id, attempt)]);
      await runPreview(j.id, attempt - 1);
      const done = await job(j.id);
      expect(done.status).toBe("ready");
      expect(done.added).toBe(2);
      expect(await prisma.importRow.count({ where: { jobId: j.id } })).toBe(2);
    });

    it("a run swept before its worker claims it changes nothing", async () => {
      const j = await ready(CSV, "replace");
      const attempt = await startRun(shopId, j.id);
      await ageJob(j.id, QUEUE_STALE_MS + 60_000, false);
      await sweepStale(shopId);
      await runImport(j.id, attempt);
      expect((await job(j.id)).status).toBe("failed");
      expect(await prisma.fitmentRow.count({ where: { shopId } })).toBe(0);
    });

    it("Replace all with no valid rows is refused before anything is deleted", async () => {
      const done = await ready(CSV);
      await startRun(shopId, done.id);
      await runImport(done.id);
      const j = await ready("Make,Year,Model,SKU\nAUDI,2008,A6,\n", "replace");
      expect(j.status).toBe("failed");
      expect(j.failureReason).toContain(
        "Replace all rows would delete everything",
      );
      expect(await prisma.fitmentRow.count({ where: { shopId } })).toBe(2);
    });

    it("re-reads as Windows-1252 when non-UTF-8 bytes appear after 64 KB", async () => {
      const ascii = Array.from(
        { length: 5000 },
        (_, i) => `AUDI,2016,A${i},S${i}`,
      ).join("\n");
      const tail = Buffer.from("\nCITROËN,2016,C4,S-last\n", "latin1");
      const file = Buffer.concat([
        Buffer.from("Make,Year,Model,SKU\n" + ascii),
        tail,
      ]);
      expect(file.length).toBeGreaterThan(64 * 1024);
      const j = await ready(file);
      expect(j.status).toBe("ready");
      expect(j.encoding).toBe("windows-1252");
      await startRun(shopId, j.id);
      await runImport(j.id);
      const row = await prisma.fitmentRow.findFirstOrThrow({
        where: { shopId, attachment: "S-last" },
      });
      expect(Object.values(row.values as object)).toContain("CITROËN");
    });

    it("a storage error after the data is written still reports the import as finished", async () => {
      for (let i = 0; i < 6; i++) {
        const j = await ready(`Make,Year,Model,SKU\nM${i},2016,X,S${i}\n`);
        if (i === 5) store.failDeletes = true; // keepNewestFiles must delete the oldest file
        await startRun(shopId, j.id);
        await runImport(j.id);
        expect((await job(j.id)).status).toBe("completed");
      }
    });
  },
);
