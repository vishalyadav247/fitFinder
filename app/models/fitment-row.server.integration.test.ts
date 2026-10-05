// Filter data against the real Postgres in DATABASE_URL: add/edit/delete, search and paging,
// counts, duplicates, shop isolation, and export → import round trips (M5 "Done when").
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ImportMode } from "@prisma/client";

const DOMAIN = "vitest-filter-data.myshopify.com";
const OTHER = "vitest-filter-data-b.myshopify.com";

vi.mock("../shopify.server", () => ({
  authenticate: {
    admin: vi.fn(async () => ({ session: { shop: DOMAIN } })),
  },
}));

const { default: prisma } = await import("../db.server");
const { upsertShopOnInstall } = await import("./shop.server");
const { applyStoreType } = await import("./search-config.server");
const {
  FitmentRuleError,
  countDuplicates,
  deleteAllRows,
  deleteRows,
  listRows,
  removeDuplicates,
  likePattern,
  rowCounts,
  saveRow,
  PAGE_SIZE,
} = await import("./fitment-row.server");
const { ATTACHMENT_KEY } = await import("../services/fitment/rows");
const { CURRENT, rowHashSql } =
  await import("../services/fitment/row-hash.server");
const { LocalStorage, newUploadKey, setStorageForTests, storage } =
  await import("../services/storage.server");
const pipeline = await import("../services/import/pipeline.server");
const { action: exportAction } = await import("../routes/api.fitment.export");

try {
  process.loadEnvFile(".env");
} catch {
  // no .env: rely on the environment
}

describe.skipIf(!process.env.DATABASE_URL)("filter data (Postgres)", () => {
  let dir: string;
  let shopId: string;
  let otherShopId: string;
  let make: string;
  let year: string;
  let model: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "ff-filter-data-"));
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
    const fields = await prisma.searchField.findMany({
      where: { shopId },
      orderBy: { position: "asc" },
    });
    [make, year, model] = fields.map((f) => f.id);
    // Model optional, so rows without one are allowed.
    await prisma.searchField.update({
      where: { id: model },
      data: { required: false },
    });
  });

  const form = (m: string, y: string, mo: string, sku: string) => ({
    [make]: m,
    [year]: y,
    [model]: mo,
    [ATTACHMENT_KEY]: sku,
  });

  async function add(
    m: string,
    y: string,
    mo: string,
    sku: string,
    shop = shopId,
  ) {
    // Field ids differ per shop: map by position for the other shop.
    if (shop !== shopId) {
      const f = await prisma.searchField.findMany({
        where: { shopId: shop },
        orderBy: { position: "asc" },
      });
      return saveRow(shop, null, {
        [f[0].id]: m,
        [f[1].id]: y,
        [f[2].id]: mo,
        [ATTACHMENT_KEY]: sku,
      });
    }
    return saveRow(shopId, null, form(m, y, mo, sku));
  }

  const rows = () =>
    prisma.fitmentRow.findMany({ where: { shopId }, orderBy: { id: "asc" } });

  /** Hashes as stored vs recomputed from the content (they must agree). */
  async function staleHashes(shop = shopId) {
    const [r] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM fitment_rows r
      WHERE r.shop_id = ${shop} AND r.row_hash <> ${rowHashSql(CURRENT, "r")}`;
    return r.n;
  }

  it("adds a row with the import's hash and refuses an exact copy", async () => {
    expect(await add("Audi", "2008-2011", "A4", "SKU-1")).toEqual({ ok: true });
    const [r] = await rows();
    expect(r.values).toEqual({ [make]: "Audi", [model]: "A4" });
    expect([r.yearFrom, r.yearTo, r.attachment]).toEqual([2008, 2011, "SKU-1"]);
    expect(await staleHashes()).toBe(0);
    await expect(add(" Audi ", "2008 - 2011", "A4", "SKU-1")).rejects.toThrow(
      "This row already exists.",
    );
  });

  it("returns field errors without writing", async () => {
    const r = await saveRow(shopId, null, form("", "soon", "", ""));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.fieldErrors).sort()).toEqual(
        [make, year, ATTACHMENT_KEY].sort(),
      );
    }
    expect(await rows()).toHaveLength(0);
  });

  it("edits a row, rehashes it and refuses to collide with another row", async () => {
    await add("Audi", "2008-2011", "A4", "SKU-1");
    await add("BMW", "2016-", "X5", "SKU-2");
    const [a, b] = await rows();
    await saveRow(shopId, a.id, form("Audi", "2009", "", "SKU-9"));
    const edited = await prisma.fitmentRow.findUniqueOrThrow({
      where: { id: a.id },
    });
    expect(edited.values).toEqual({ [make]: "Audi" });
    expect([edited.yearFrom, edited.yearTo, edited.attachment]).toEqual([
      2009,
      2009,
      "SKU-9",
    ]);
    expect(await staleHashes()).toBe(0);
    await expect(
      saveRow(shopId, a.id, form("BMW", "2016-", "X5", "SKU-2")),
    ).rejects.toThrow("Another row already has these values.");
    // Saving a row unchanged is fine.
    await expect(
      saveRow(shopId, b.id, form("BMW", "2016-", "X5", "SKU-2")),
    ).resolves.toEqual({ ok: true });
  });

  it("never touches another shop's rows", async () => {
    await add("Audi", "2010", "A4", "SKU-1");
    await add("Audi", "2010", "A4", "SKU-1", otherShopId);
    const theirs = await prisma.fitmentRow.findFirstOrThrow({
      where: { shopId: otherShopId },
    });
    await expect(
      saveRow(shopId, theirs.id, form("X", "2010", "", "Y")),
    ).rejects.toThrow("This row no longer exists.");
    expect(await deleteRows(shopId, [theirs.id])).toBe(0);
    expect(await deleteAllRows(shopId)).toBe(1);
    expect(
      await prisma.fitmentRow.count({ where: { shopId: otherShopId } }),
    ).toBe(1);
    const page = await listRows(shopId, {});
    expect(page.rows).toHaveLength(0);
  });

  it("lists newest first, pages, searches values, years and SKU", async () => {
    for (let i = 0; i < PAGE_SIZE + 3; i++) {
      await add(
        i % 2 ? "Audi" : "BMW",
        `${2000 + (i % 10)}-2020`,
        `M${i}`,
        `SKU-${i}`,
      );
    }
    const first = await listRows(shopId, {});
    expect(first.rows).toHaveLength(PAGE_SIZE);
    expect(first.hasNextPage).toBe(true);
    expect(first.matching).toBeNull();
    expect(first.rows[0].attachment).toBe(`SKU-${PAGE_SIZE + 2}`);
    const second = await listRows(shopId, { page: 2 });
    expect(second.rows).toHaveLength(3);
    expect(second.hasNextPage).toBe(false);

    expect((await listRows(shopId, { q: "audi" })).matching).toBe(26);
    // SKU-5, SKU-50, SKU-51, SKU-52
    expect((await listRows(shopId, { q: "sku-5" })).matching).toBe(4);
    expect((await listRows(shopId, { q: "2003-2020" })).matching).toBe(5);
    // LIKE wildcards are literal.
    expect((await listRows(shopId, { q: "%" })).matching).toBe(0);
    expect((await listRows(shopId, { q: "_" })).matching).toBe(0);
  });

  it("marks linked rows and counts unlinked SKUs", async () => {
    await add("Audi", "2010", "A4", "SKU-1");
    await add("Audi", "2011", "A4", "SKU-1");
    await add("BMW", "2012", "X5", "SKU-2");
    await add("BMW", "2013", "X5", "SKU-3");
    await prisma.productLink.create({
      data: {
        shopId,
        attachment: "SKU-2",
        kind: "sku",
        productId: "gid://shopify/Product/1",
      },
    });
    // A link in another shop doesn't count.
    await prisma.productLink.create({
      data: {
        shopId: otherShopId,
        attachment: "SKU-3",
        kind: "sku",
        productId: "gid://shopify/Product/2",
      },
    });
    expect(await rowCounts(shopId)).toEqual({
      total: 4,
      unlinkedRows: 3,
      unlinkedSkus: 2,
    });
    const page = await listRows(shopId, {});
    expect(page.rows.filter((r) => r.linked).map((r) => r.attachment)).toEqual([
      "SKU-2",
    ]);
  });

  it("removes duplicates that differ only in case and spaces, keeping the oldest", async () => {
    await add("Audi", "2010", "A4 Avant", "SKU-1");
    await add("AUDI", "2010", "a4avant", "sku-1");
    await add("audi", "2010", "A4 AVANT", "SKU- 1");
    await add("Audi", "2011", "A4 Avant", "SKU-1"); // other year: not a duplicate
    await add("Audi", "2010", "A4 Avant", "SKU-1", otherShopId);
    await add("AUDI", "2010", "A4 Avant", "SKU-1", otherShopId);
    expect(await countDuplicates(shopId)).toBe(2);
    const oldest = (await rows())[0].id;
    expect(await removeDuplicates(shopId)).toBe(2);
    const left = await rows();
    expect(left.map((r) => r.id)).toContain(oldest);
    expect(left).toHaveLength(2);
    expect(await countDuplicates(otherShopId)).toBe(1);
  });

  it("refuses writes while an import is running", async () => {
    await prisma.importJob.create({
      data: { shopId, fileName: "x.csv", status: "running" },
    });
    await expect(add("Audi", "2010", "A4", "SKU-1")).rejects.toBeInstanceOf(
      FitmentRuleError,
    );
    await expect(deleteAllRows(shopId)).rejects.toThrow("An import is running");
  });

  it("fails an import whose worker died instead of blocking edits", async () => {
    const job = await prisma.importJob.create({
      data: {
        shopId,
        fileName: "x.csv",
        status: "running",
        claimedAt: new Date(),
      },
    });
    // No heartbeat for an hour (updated_at is maintained by Prisma, so set it in SQL).
    await prisma.$executeRaw`
      UPDATE import_jobs SET updated_at = now() - interval '1 hour' WHERE id = ${job.id}`;
    expect(await add("Audi", "2010", "A4", "SKU-1")).toEqual({ ok: true });
    expect(
      (await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe("failed");
  });

  it("says so when another change holds the setup lock", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM search_configs WHERE shop_id = ${shopId} FOR UPDATE`;
        locked();
        await held;
      },
      { timeout: 30_000 },
    );
    await isLocked;
    try {
      await expect(add("Audi", "2010", "A4", "SKU-1")).rejects.toThrow(
        "Your filter data is being changed right now. Try again in a moment.",
      );
    } finally {
      release();
      await holder;
    }
    expect(await rows()).toHaveLength(0);
  }, 30_000);

  it("treats LIKE wildcards in a search literally", async () => {
    expect(likePattern("50%_a\\b")).toBe("%50\\%\\_a\\\\b%");
    await add("Audi", "2010", "100%", "SKU-1");
    await add("Audi", "2010", "1000", "SKU-2");
    expect((await listRows(shopId, { q: "100%" })).matching).toBe(1);
  });

  // ------------------------------------------------------------ export → import

  async function exportCsv(body: unknown) {
    const res = (await exportAction({
      request: new Request("https://app.test/api/fitment/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      params: {},
      context: {},
    } as never)) as Response;
    return {
      status: res.status,
      count: res.headers.get("X-Row-Count"),
      // Keep the BOM (Response.text() drops it) to check it is there.
      text:
        res.status === 200
          ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(
              await res.arrayBuffer(),
            )
          : "",
    };
  }

  async function importCsv(csv: string, mode: ImportMode) {
    const key = newUploadKey(shopId, "export.csv");
    await storage().put(key, Buffer.from(csv));
    const { job, choices } = await pipeline.createImport(shopId, {
      key,
      fileName: "export.csv",
      mode,
    });
    expect(choices).toEqual([make, year, model, "attachment"]);
    await pipeline.saveMapping(shopId, job.id, {
      choices,
      hasHeader: true,
      lookForSkus: true,
      mode,
    });
    await pipeline.runPreview(job.id);
    await pipeline.startRun(shopId, job.id);
    await pipeline.runImport(job.id);
    return prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
  }

  const content = async () =>
    (await rows()).map((r) => [
      r.values,
      r.yearFrom,
      r.yearTo,
      r.attachment,
      r.rowHash,
    ]);

  async function seedTricky() {
    await add("Škoda", "2008-2011", 'Octavia "RS", 5d', "SKU-1");
    await add('=HYPERLINK("x")', "2016-", "", "-SKU+2");
    await add("Ford", "2019", "Focus", "https://shop.test/products/focus");
    await add("@Mini", "2001-2003", "+Cooper", "SKU;4");
  }

  it("export all → Add and update import changes nothing", async () => {
    await seedTricky();
    const before = await content();
    const exported = await exportCsv({ scope: "all" });
    expect(exported.status).toBe(200);
    expect(exported.count).toBe("4");
    expect(exported.text.charCodeAt(0)).toBe(0xfeff);
    expect(exported.text.slice(1).split("\r\n")[0]).toBe(
      "Make,Year,Model,Attachment",
    );

    const job = await importCsv(exported.text, "upsert");
    expect(job.status).toBe("completed");
    expect([job.added, job.unchanged, job.errors]).toEqual([0, 4, 0]);
    expect(await content()).toEqual(before);
  });

  it("export all → Replace all rows import gives the same rows", async () => {
    await seedTricky();
    const before = (await content()).map((r) => r[4]).sort();
    const exported = await exportCsv({ scope: "all" });
    const job = await importCsv(exported.text, "replace");
    expect([job.deleted, job.imported, job.errors]).toEqual([4, 4, 0]);
    expect((await content()).map((r) => r[4]).sort()).toEqual(before);
  });

  it("exports selected and unlinked rows only, never another shop's", async () => {
    await seedTricky();
    await add("Opel", "2010", "Astra", "THEIRS", otherShopId);
    const theirs = await prisma.fitmentRow.findFirstOrThrow({
      where: { shopId: otherShopId },
    });
    const [a, b] = await rows();
    await prisma.productLink.create({
      data: {
        shopId,
        attachment: a.attachment,
        kind: "sku",
        productId: "gid://shopify/Product/1",
      },
    });
    const selected = await exportCsv({
      scope: "selected",
      ids: [String(b.id), String(theirs.id)],
    });
    expect(selected.count).toBe("1");
    expect(selected.text).toContain("-SKU+2");
    expect(selected.text).not.toContain("THEIRS");
    const unlinked = await exportCsv({ scope: "unmatched" });
    expect(unlinked.count).toBe("3");
    expect(unlinked.text).not.toContain("SKU-1");

    // Delete listed rows with the selected export removes exactly that row.
    const job = await importCsv(selected.text, "delete");
    expect([job.deleted, job.notFound]).toEqual([1, 0]);
    expect(await rows()).toHaveLength(3);

    expect((await exportCsv({ scope: "selected", ids: [] })).status).toBe(400);
    expect((await exportCsv({ scope: "everything" })).status).toBe(400);
  });
});
