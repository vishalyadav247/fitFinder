// End-to-end import pipeline against the real Postgres in DATABASE_URL, with a temp folder as
// storage. Calls the job steps directly (no queue). Skipped when no database is configured.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { text } from "node:stream/consumers";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ImportMode } from "@prisma/client";
import prisma from "../../db.server";
import { upsertShopOnInstall } from "../../models/shop.server";
import { applyStoreType } from "../../models/search-config.server";
import { CURRENT, rowHashSql } from "../fitment/row-hash.server";
import {
  LocalStorage,
  newUploadKey,
  setStorageForTests,
  storage,
} from "../storage.server";
import {
  ImportError,
  KEEP_FILES,
  cancelImport,
  createImport,
  importHistory,
  runImport,
  runPreview,
  saveMapping,
  startRun,
} from "./pipeline.server";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env: rely on the environment
}

const DOMAIN = "vitest-import.myshopify.com";
const OTHER = "vitest-import-b.myshopify.com";

const AUTOMOTIVE_CSV = [
  "Make;Year from;Year to;Model;SKU",
  "AUDI;02/05;12/08;A6\u00a0Avant;47-116573",
  "BMW;2016;/;3 GT;35-217480",
  "BMW;2016;/;3 GT;35-217480",
  ";2016;;X5;99-1",
  "FORD;2011;2008;Focus;19-1",
  "FORD;2021;2025;Focus;",
].join("\n");

describe.skipIf(!process.env.DATABASE_URL)("import pipeline (Postgres)", () => {
  let dir: string;
  let shopId: string;
  let otherShopId: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "ff-storage-"));
    setStorageForTests(new LocalStorage(dir));
  });

  afterAll(async () => {
    await prisma.shop.deleteMany({
      where: { domain: { in: [DOMAIN, OTHER] } },
    });
    setStorageForTests(undefined);
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await prisma.shop.deleteMany({
      where: { domain: { in: [DOMAIN, OTHER] } },
    });
    shopId = (await upsertShopOnInstall(DOMAIN)).id;
    otherShopId = (await upsertShopOnInstall(OTHER)).id;
    await applyStoreType(shopId, "automotive", { replace: false });
    await applyStoreType(otherShopId, "automotive", { replace: false });
  });

  async function upload(
    body: string | Buffer,
    name = "data.csv",
    shop = shopId,
  ) {
    const key = newUploadKey(shop, name);
    await storage().put(
      key,
      typeof body === "string" ? Buffer.from(body) : body,
    );
    return key;
  }

  async function importFile(
    body: string | Buffer,
    mode: ImportMode,
    opts: { choices?: string[]; name?: string } = {},
  ) {
    const key = await upload(body, opts.name);
    const { job, choices } = await createImport(shopId, {
      key,
      fileName: opts.name ?? "data.csv",
      mode,
    });
    await saveMapping(shopId, job.id, {
      choices: opts.choices ?? choices,
      hasHeader: true,
      lookForSkus: true,
      mode,
    });
    await runPreview(job.id);
    const ready = await prisma.importJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    return { job: ready, choices };
  }

  async function finish(jobId: string) {
    await startRun(shopId, jobId);
    await runImport(jobId);
    return prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
  }

  const rows = () =>
    prisma.fitmentRow.findMany({ where: { shopId }, orderBy: { id: "asc" } });

  it("reads the file, pre-fills the mapping by header names", async () => {
    const key = await upload(AUTOMOTIVE_CSV);
    const fields = await prisma.searchField.findMany({
      where: { shopId },
      orderBy: { position: "asc" },
    });
    const { job, choices } = await createImport(shopId, {
      key,
      fileName: "data.csv",
      mode: "upsert",
    });
    expect(job.delimiter).toBe(";");
    expect(job.status).toBe("uploaded");
    expect(choices).toEqual([
      fields[0].id, // Make
      fields[1].id, // Year from
      fields[1].id, // Year to
      fields[2].id, // Model
      "attachment", // SKU
    ]);
  });

  it("add and update: counts in review match the result; errors go to the report", async () => {
    const { job } = await importFile(AUTOMOTIVE_CSV, "upsert");
    expect(job.status).toBe("ready");
    expect([job.added, job.unchanged, job.errors]).toEqual([2, 1, 3]);
    expect(job.reportKey).toBeTruthy();
    const report = await text(await storage().get(job.reportKey!));
    expect(report.split("\n")[0]).toBe(
      "Line,Problem,Make,Year,Model,Attachment",
    );
    expect(report).toContain("5,Make is empty");
    expect(report).toContain("6,Year isn't a valid year or year range");
    expect(report).toContain("7,Attachment is empty");

    const done = await finish(job.id);
    expect(done.status).toBe("completed");
    expect([done.added, done.unchanged, done.errors]).toEqual([2, 1, 3]);

    const r = await rows();
    const imported = r
      .map((x) => [x.attachment, x.yearFrom, x.yearTo])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(imported).toEqual([
      ["35-217480", 2016, null],
      ["47-116573", 2005, 2008],
    ]);
    expect(
      Object.values(
        r.find((x) => x.attachment === "47-116573")!.values as object,
      ),
    ).toContain("A6 Avant");

    // Hashes are the app's formula.
    const [{ stale }] = await prisma.$queryRaw<{ stale: number }[]>`
      SELECT count(*)::int AS stale FROM fitment_rows r
      WHERE r.shop_id = ${shopId} AND r.row_hash <> ${rowHashSql(CURRENT, "r")}`;
    expect(stale).toBe(0);

    // Staging rows are gone; mapping saved by column title.
    expect(await prisma.importRow.count({ where: { jobId: job.id } })).toBe(0);
    const saved = await prisma.importMapping.findMany({ where: { shopId } });
    expect(saved.map((m) => m.columnName).sort()).toEqual([
      "Make",
      "Model",
      "SKU",
      "Year from",
      "Year to",
    ]);

    // Same file again: nothing new.
    const { job: again } = await importFile(AUTOMOTIVE_CSV, "upsert");
    expect([again.added, again.unchanged]).toEqual([0, 3]);
  });

  it("replace all: deletes current rows and imports the file atomically", async () => {
    await finish((await importFile(AUTOMOTIVE_CSV, "upsert")).job.id);
    const next = "Make,Year,Model,SKU\nVOLVO,2016-,XC90,22-1\n";
    const { job } = await importFile(gzipSync(next), "replace", {
      name: "next.csv",
    });
    expect([job.deleted, job.imported, job.errors]).toEqual([2, 1, 0]);
    expect(job.reportKey).toBeNull();
    await finish(job.id);
    const r = await rows();
    expect(r.map((x) => [x.attachment, x.yearFrom, x.yearTo])).toEqual([
      ["22-1", 2016, null],
    ]);
  });

  it("delete listed rows: exact matches only, with a not-found report", async () => {
    await finish((await importFile(AUTOMOTIVE_CSV, "upsert")).job.id);
    const del = [
      "Make;Year from;Year to;Model;SKU",
      "BMW;2016;/;3 GT;35-217480",
      "BMW;2017;/;3 GT;35-217480",
    ].join("\n");
    const { job } = await importFile(del, "delete");
    expect([job.deleted, job.notFound, job.rowsLeft]).toEqual([1, 1, 1]);
    const report = await text(await storage().get(job.reportKey!));
    expect(report).toContain("3,No exact match,BMW,2017-,3 GT,35-217480");
    const done = await finish(job.id);
    expect([done.deleted, done.notFound, done.rowsLeft]).toEqual([1, 1, 1]);
    expect((await rows()).map((x) => x.attachment)).toEqual(["47-116573"]);
  });

  it("needs an Attachment column", async () => {
    const key = await upload(AUTOMOTIVE_CSV);
    const { job, choices } = await createImport(shopId, {
      key,
      fileName: "data.csv",
      mode: "upsert",
    });
    await expect(
      saveMapping(shopId, job.id, {
        choices: choices.map((c) => (c === "attachment" ? "skip" : c)),
        hasHeader: true,
        lookForSkus: true,
        mode: "upsert",
      }),
    ).rejects.toThrow("Map the Attachment column");
  });

  it("refuses another shop's upload and another shop's job", async () => {
    const key = await upload(AUTOMOTIVE_CSV, "x.csv", otherShopId);
    await expect(
      createImport(shopId, { key, fileName: "x.csv", mode: "upsert" }),
    ).rejects.toBeInstanceOf(ImportError);

    const { job } = await importFile(AUTOMOTIVE_CSV, "upsert");
    await expect(cancelImport(otherShopId, job.id)).rejects.toBeInstanceOf(
      ImportError,
    );
    await expect(startRun(otherShopId, job.id)).rejects.toBeInstanceOf(
      ImportError,
    );
  });

  it("fails cleanly when a mapped field was deleted before the run", async () => {
    const { job } = await importFile(AUTOMOTIVE_CSV, "upsert");
    const model = await prisma.searchField.findFirstOrThrow({
      where: { shopId, label: "Model" },
    });
    await prisma.searchField.delete({ where: { id: model.id } });
    const done = await finish(job.id);
    expect(done.status).toBe("failed");
    expect(done.failureReason).toBe(
      "Your search fields changed. Map the columns again.",
    );
    expect(await rows()).toEqual([]);
  });

  it("cancel deletes the job's file and staging rows; a new import cancels the old draft", async () => {
    const { job } = await importFile(AUTOMOTIVE_CSV, "upsert");
    await cancelImport(shopId, job.id);
    const c = await prisma.importJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(c.status).toBe("cancelled");
    expect(await prisma.importRow.count({ where: { jobId: job.id } })).toBe(0);

    const { job: draft } = await importFile(AUTOMOTIVE_CSV, "upsert");
    const key = await upload(AUTOMOTIVE_CSV);
    await createImport(shopId, { key, fileName: "data.csv", mode: "upsert" });
    expect(
      (await prisma.importJob.findUniqueOrThrow({ where: { id: draft.id } }))
        .status,
    ).toBe("cancelled");
  });

  it(`keeps the files of the ${KEEP_FILES} newest imports`, async () => {
    const keys: string[] = [];
    for (let i = 0; i < KEEP_FILES + 2; i++) {
      const { job } = await importFile(
        `Make,Year,Model,SKU\nM${i},2016,X,S${i}\n`,
        "upsert",
        {
          name: `f${i}.csv`,
        },
      );
      keys.push(job.fileKey!);
      await finish(job.id);
    }
    const history = await importHistory(shopId);
    expect(history.map((h) => h.fileName)).toEqual([
      "f6.csv",
      "f5.csv",
      "f4.csv",
      "f3.csv",
      "f2.csv",
    ]);
    expect(await storage().size(keys[0])).toBeNull();
    expect(await storage().size(keys[1])).toBeNull();
    expect(await storage().size(keys[6])).not.toBeNull();
  });
});
