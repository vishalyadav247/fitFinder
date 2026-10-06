// End-to-end merchant journey across every feature, against the real Postgres, real pg-boss jobs
// and the library's own auth, with Shopify faked at the HTTP boundary (fake-shopify.ts):
// install → onboarding → search setup → CSV import → filter data → product mapping and linking →
// products webhook → storefront settings and theme status → storefront proxy (options, search,
// fits, results) → dashboard → plans → settings → uninstall, compliance webhooks and purge.
// A second shop runs alongside to prove tenant isolation at each step.
import {
  adminRequest,
  cleanLeftovers,
  removeStorage,
  run,
  shopify,
  stopJobs,
  storageDir,
  waitFor,
} from "./harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  proxyUrl,
  sessionToken,
  webhookRequest,
  type FakeProduct,
} from "./fake-shopify";

// The export starts with a byte order mark (built from its code: escapes get mangled in edits).
const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);
const RUN = randomBytes(4).toString("hex");
const SHOP = `e2e-parts-${RUN}.myshopify.com`;
const OTHER = `e2e-phones-${RUN}.myshopify.com`;

const { default: prisma } = await import("../db.server");
const routes = {
  layout: await import("../routes/app"),
  onboarding: await import("../routes/app.onboarding"),
  searchSetup: await import("../routes/app.search-setup"),
  imports: await import("../routes/api.imports"),
  importOne: await import("../routes/api.imports.$id"),
  importFile: await import("../routes/api.imports.$id.file"),
  uploads: await import("../routes/api.uploads"),
  filterData: await import("../routes/app.filter-data"),
  fitment: await import("../routes/api.fitment"),
  exportCsv: await import("../routes/api.fitment.export"),
  mapping: await import("../routes/app.product-mapping"),
  linkStatus: await import("../routes/api.links.status"),
  productsWebhook: await import("../routes/webhooks.products"),
  storefront: await import("../routes/app.storefront"),
  storefrontSettings: await import("../routes/api.storefront-settings"),
  proxyOptions: await import("../routes/proxy.options"),
  proxySearch: await import("../routes/proxy.search"),
  proxyFits: await import("../routes/proxy.fits"),
  proxyResults: await import("../routes/proxy.results"),
  dashboard: await import("../routes/app._index"),
  plans: await import("../routes/app.plans"),
  settings: await import("../routes/app.settings"),
  uninstalled: await import("../routes/webhooks.app.uninstalled"),
  compliance: await import("../routes/webhooks.compliance"),
};

const BLOCK = (handle: string) =>
  `shopify://apps/fitfinder/blocks/${handle}/0199e2e0-0000-7000-8000-000000000000`;
const THEME_FILES = {
  "config/settings_data.json": JSON.stringify({
    current: {
      blocks: { embed1: { type: BLOCK("fitfinder-embed"), disabled: false } },
    },
  }),
  "templates/index.json": JSON.stringify({
    sections: {
      ff: {
        type: "_blocks",
        blocks: { s: { type: BLOCK("fitfinder-search"), settings: {} } },
      },
    },
  }),
  "templates/product.json": JSON.stringify({
    sections: {
      main: {
        type: "main-product",
        blocks: { b: { type: BLOCK("fitfinder-fits-badge"), settings: {} } },
      },
    },
  }),
};

const CSV = [
  "Make,Year,Model,SKU",
  "Audi,2008-2011,A4,BP-100",
  "Audi,2012-2015,A4,BP-100",
  "Audi,2010,A6,OF-200",
  "BMW,2015-2018,320i,SP-300",
  "BMW,2015-2018,320i,OF-200",
  "Ford,2019,Focus,NO-SUCH-SKU",
  "Ford,20x9,Focus,BP-100",
].join("\r\n");

describe("FitFinder end to end", () => {
  let shopId: string;
  const fieldIds: Record<string, string> = {};
  const catalog = {} as Record<
    "brakes" | "oil" | "plugs" | "mats" | "wipers" | "draft",
    FakeProduct
  >;

  beforeAll(async () => {
    await cleanLeftovers();
    shopify.shop(OTHER);
    catalog.brakes = shopify.addProduct(SHOP, {
      title: "Brake Pad Set",
      skus: ["BP-100"],
    });
    catalog.oil = shopify.addProduct(SHOP, {
      title: "Oil Filter",
      skus: ["OF-200"],
    });
    catalog.plugs = shopify.addProduct(SHOP, {
      title: "Spark Plug",
      skus: ["SP-300", "SP-301"],
    });
    catalog.mats = shopify.addProduct(SHOP, {
      title: "Floor Mats",
      skus: ["FM-1"],
    });
    catalog.wipers = shopify.addProduct(SHOP, {
      title: "Wiper Blades",
      skus: ["WB-9"],
    });
    catalog.draft = shopify.addProduct(SHOP, {
      title: "Old Part",
      status: "DRAFT",
      skus: ["DR-1"],
    });
    shopify.addCollection(SHOP, "Audi Parts");
    shopify.addTheme(SHOP, {
      name: "Horizon",
      role: "MAIN",
      files: THEME_FILES,
    });
    shopify.addTheme(SHOP, { name: "Dawn", role: "UNPUBLISHED", files: {} });
  });

  afterAll(async () => {
    await stopJobs();
    await prisma.session.deleteMany({ where: { shop: { in: [SHOP, OTHER] } } });
    await prisma.shop.deleteMany({ where: { domain: { in: [SHOP, OTHER] } } });
    removeStorage();
  });

  it("installs on the first admin visit and sends a new shop to onboarding", async () => {
    const res = await run(routes.layout.loader, adminRequest(SHOP, "/app"));
    expect(res.status).toBe(302);
    expect(res.location).toContain("/app/onboarding");

    // Token exchange stored the offline session; afterAuth created the shop.
    const session = await prisma.session.findFirst({ where: { shop: SHOP } });
    expect(session?.isOnline).toBe(false);
    const shop = await prisma.shop.findUniqueOrThrow({
      where: { domain: SHOP },
    });
    expect(shop.uninstalledAt).toBeNull();
    shopId = shop.id;

    const onboarding = await run(
      routes.layout.loader,
      adminRequest(SHOP, "/app/onboarding"),
    );
    expect(onboarding.status).toBe(200);
  });

  it("rejects a request without a valid session token", async () => {
    const forged = new Request("https://app.e2e.test/app/search-setup", {
      headers: { Authorization: "Bearer not-a-token" },
    });
    const res = await run(routes.searchSetup.loader, forged);
    expect(res.status).toBe(401);
    // A token signed with another app's secret doesn't install anything either.
    const stranger = `e2e-stranger-${RUN}.myshopify.com`;
    shopify.shop(stranger);
    const token = sessionToken(stranger).split(".");
    token[2] = Buffer.from("forged-signature").toString("base64url");
    const wrongKey = await run(
      routes.searchSetup.loader,
      new Request("https://app.e2e.test/app/search-setup", {
        headers: { Authorization: `Bearer ${token.join(".")}` },
      }),
    );
    expect(wrongKey.status).toBe(401);
    expect(await prisma.shop.count({ where: { domain: stranger } })).toBe(0);
    expect(await prisma.session.count({ where: { shop: stranger } })).toBe(0);
  });

  it("onboarding seeds the store type's fields (one store type per store)", async () => {
    const bad = await run(
      routes.onboarding.action,
      adminRequest(SHOP, "/app/onboarding", {
        method: "POST",
        body: { form: { storeType: "boats", replace: "false" } },
      }),
    );
    expect(bad.status).toBe(400);

    const ok = await run(
      routes.onboarding.action,
      adminRequest(SHOP, "/app/onboarding", {
        method: "POST",
        body: { form: { storeType: "automotive", replace: "false" } },
      }),
    );
    expect(ok.status).toBe(302);

    // A second Continue without "Replace my setup" is refused.
    const again = await run(
      routes.onboarding.action,
      adminRequest(SHOP, "/app/onboarding", {
        method: "POST",
        body: { form: { storeType: "phones", replace: "false" } },
      }),
    );
    expect(again.status).toBe(409);

    const other = await run(
      routes.onboarding.action,
      adminRequest(OTHER, "/app/onboarding", {
        method: "POST",
        body: { form: { storeType: "phones", replace: "false" } },
      }),
    );
    expect(other.status).toBe(302);

    const setup = await run(
      routes.searchSetup.loader,
      adminRequest(SHOP, "/app/search-setup"),
    );
    expect(setup.status).toBe(200);
    expect(setup.body.storeType).toBe("automotive");
    const labels = setup.body.fields.map((f: { label: string }) => f.label);
    expect(labels).toEqual(["Make", "Year", "Model"]);
    for (const f of setup.body.fields) fieldIds[f.label] = f.id;

    const layout = await run(routes.layout.loader, adminRequest(SHOP, "/app"));
    expect(layout.status).toBe(200);
  });

  it("search setup edits fields and enforces its rules", async () => {
    const post = (shop: string, form: Record<string, string>) =>
      run(
        routes.searchSetup.action,
        adminRequest(shop, "/app/search-setup", {
          method: "POST",
          body: { form },
        }),
      );

    const added = await post(SHOP, { intent: "add" });
    expect(added.body).toMatchObject({ ok: true });
    const fields = await prisma.searchField.findMany({
      where: { shopId },
      orderBy: { position: "asc" },
    });
    expect(fields).toHaveLength(4);
    const extra = fields[3];

    expect(
      (
        await post(SHOP, {
          intent: "label",
          fieldId: extra.id,
          value: "Engine",
        })
      ).body.ok,
    ).toBe(true);
    expect(
      (await post(SHOP, { intent: "move", fieldId: extra.id, value: "up" }))
        .body.ok,
    ).toBe(true);
    // A second Year range field is refused.
    const twoYears = await post(SHOP, {
      intent: "type",
      fieldId: extra.id,
      value: "year_range",
    });
    expect(twoYears.status).toBe(409);
    // Another shop can't touch this shop's field.
    const foreign = await post(OTHER, {
      intent: "label",
      fieldId: extra.id,
      value: "Hijacked",
    });
    expect(foreign.status).not.toBe(200);
    expect(
      (await prisma.searchField.findUniqueOrThrow({ where: { id: extra.id } }))
        .label,
    ).toBe("Engine");

    const order = await prisma.searchField.findMany({
      where: { shopId },
      orderBy: { position: "asc" },
      select: { label: true },
    });
    expect(order.map((f) => f.label)).toEqual([
      "Make",
      "Year",
      "Engine",
      "Model",
    ]);

    const deleted = await post(SHOP, { intent: "delete", fieldId: extra.id });
    expect(deleted.body).toMatchObject({ ok: true, toast: "Field deleted" });
    expect(await prisma.searchField.count({ where: { shopId } })).toBe(3);

    expect((await post(SHOP, { intent: "nope" })).status).toBe(400);
  });

  /** Upload → create → map → check run → import, as the Import CSV card does it. */
  async function importCsv(
    shop: string,
    fileName: string,
    csv: string,
    mode: "upsert" | "replace" | "delete",
  ) {
    const api = (body: unknown) =>
      run(
        routes.imports.action,
        adminRequest(shop, "/api/imports", {
          method: "POST",
          body: { json: body },
        }),
      );
    const target = await api({
      intent: "upload-target",
      fileName,
      size: Buffer.byteLength(csv),
    });
    expect(target.status).toBe(200);
    expect(target.body.target.method).toBe("PUT");
    const put = await run(
      routes.uploads.action,
      adminRequest(shop, target.body.target.url, {
        method: "PUT",
        body: { raw: csv, contentType: "text/csv" },
      }),
    );
    expect(put.status).toBe(204);

    const created = await api({
      intent: "create",
      key: target.body.key,
      fileName,
      mode,
    });
    expect(created.status).toBe(200);
    expect(created.body.job.status).toBe("uploaded");
    const jobId: string = created.body.job.id;

    const one = (method: string, body?: unknown) =>
      run(
        method === "GET" ? routes.importOne.loader : routes.importOne.action,
        adminRequest(shop, `/api/imports/${jobId}`, {
          method,
          body: body === undefined ? undefined : { json: body },
        }),
        { id: jobId },
      );
    const until = (status: string) =>
      waitFor(`import ${status}`, async () => {
        const res = await one("GET");
        if (res.body.job.status === "failed") {
          throw new Error(`import failed: ${res.body.job.failureReason}`);
        }
        return res.body.job.status === status && res.body.job;
      });

    // The header names are pre-filled: Make/Year/Model → fields, SKU → Attachment.
    const choices: string[] = created.body.choices;
    expect(choices).toContain("attachment");
    const mapped = await one("POST", {
      intent: "map",
      choices,
      hasHeader: true,
      lookForSkus: true,
      mode,
    });
    expect(mapped.status).toBe(200);
    const ready = await until("ready");
    expect((await one("POST", { intent: "run" })).status).toBe(200);
    const done = await until("completed");
    return { jobId, ready, done };
  }

  it("imports a CSV through upload, mapping, check run and import jobs", async () => {
    const { jobId, ready, done } = await importCsv(
      SHOP,
      "parts.csv",
      CSV,
      "upsert",
    );
    expect(ready.counts.errors).toBe(1); // "20x9" isn't a year
    expect(done.counts.added).toBe(6);
    expect(await prisma.fitmentRow.count({ where: { shopId } })).toBe(6);

    // The history entry and the error report.
    expect(done.hasReport).toBe(true);
    const setup = await run(
      routes.searchSetup.loader,
      adminRequest(SHOP, "/app/search-setup"),
    );
    expect(setup.body.currentRows).toBe(6);
    expect(setup.body.history[0]).toMatchObject({ id: jobId, mode: "upsert" });

    const report = await run(
      routes.importFile.loader,
      adminRequest(SHOP, `/api/imports/${jobId}/file?kind=report`),
      { id: jobId },
    );
    expect(report.status).toBe(200);
    expect(String(report.body)).toContain("20x9");
    // Another shop can't read this import.
    const foreign = await run(
      routes.importOne.loader,
      adminRequest(OTHER, `/api/imports/${jobId}`),
      { id: jobId },
    );
    expect(foreign.status).toBe(404);

    // Re-importing the same file adds nothing (rows are deduplicated by hash).
    const again = await importCsv(SHOP, "parts.csv", CSV, "upsert");
    expect(again.done.counts.added).toBe(0);
    expect(again.done.counts.unchanged).toBe(6);
  });

  it("another shop can't touch this shop's imports or uploads", async () => {
    const job = await prisma.importJob.findFirstOrThrow({
      where: { shopId },
      orderBy: { createdAt: "desc" },
    });
    for (const body of [
      {
        intent: "map",
        choices: ["skip"],
        hasHeader: true,
        lookForSkus: true,
        mode: "upsert",
      },
      { intent: "run" },
      { intent: "cancel" },
    ]) {
      const res = await run(
        routes.importOne.action,
        adminRequest(OTHER, `/api/imports/${job.id}`, {
          method: "POST",
          body: { json: body },
        }),
        { id: job.id },
      );
      expect(res.status).toBe(409);
    }
    const report = await run(
      routes.importFile.loader,
      adminRequest(OTHER, `/api/imports/${job.id}/file?kind=report`),
      { id: job.id },
    );
    expect(report.status).toBe(404);
    expect(
      (await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe("completed");

    // An upload key of this shop: the other shop can neither write it nor import it.
    const target = await run(
      routes.imports.action,
      adminRequest(SHOP, "/api/imports", {
        method: "POST",
        body: {
          json: { intent: "upload-target", fileName: "x.csv", size: 10 },
        },
      }),
    );
    const put = await run(
      routes.uploads.action,
      adminRequest(OTHER, target.body.target.url, {
        method: "PUT",
        body: { raw: "a,b\n1,2\n", contentType: "text/csv" },
      }),
    );
    expect(put.status).toBe(403);
    const create = await run(
      routes.imports.action,
      adminRequest(OTHER, "/api/imports", {
        method: "POST",
        body: {
          json: {
            intent: "create",
            key: target.body.key,
            fileName: "x.csv",
            mode: "upsert",
          },
        },
      }),
    );
    expect(create.status).toBe(409);

    // Server-side limits: over 100 MB is refused before any upload.
    const huge = await run(
      routes.imports.action,
      adminRequest(SHOP, "/api/imports", {
        method: "POST",
        body: {
          json: {
            intent: "upload-target",
            fileName: "huge.csv",
            size: 101 * 1024 * 1024,
          },
        },
      }),
    );
    expect(huge.status).toBe(400);
  });

  it("delete and replace imports change only what the file says", async () => {
    const header = "Make,Year,Model,SKU";
    const removed = await importCsv(
      SHOP,
      "remove.csv",
      [header, "Ford,2019,Focus,NO-SUCH-SKU", "Fiat,2001,Punto,NOPE"].join(
        "\r\n",
      ),
      "delete",
    );
    expect(removed.done.counts).toMatchObject({ deleted: 1, notFound: 1 });
    expect(await prisma.fitmentRow.count({ where: { shopId } })).toBe(5);

    // Replace: all current rows give way to the file's rows.
    const replaced = await importCsv(SHOP, "parts.csv", CSV, "replace");
    expect(replaced.done.counts.deleted).toBe(5);
    expect(await prisma.fitmentRow.count({ where: { shopId } })).toBe(6);

    // Imports queue link checks; let them finish before Product mapping is visited.
    await waitFor("link checks settled", async () => {
      const sync = await prisma.catalogSync.findUnique({ where: { shopId } });
      if (sync?.status === "failed") throw new Error(sync.error ?? "failed");
      return (
        sync?.status === "completed" &&
        sync.pendingFullSync === null &&
        sync.syncedAt !== null
      );
    });
  });

  it("filter data lists, searches, adds, edits, deletes, dedupes and exports rows", async () => {
    const page = await run(
      routes.filterData.loader,
      adminRequest(SHOP, "/app/filter-data"),
    );
    expect(page.body.counts).toMatchObject({ total: 6, skus: 4 });

    const list = async (q = "", shop = SHOP) =>
      (
        await run(
          routes.fitment.loader,
          adminRequest(
            shop,
            `/api/fitment?q=${encodeURIComponent(q)}&pageSize=10`,
          ),
        )
      ).body;
    expect((await list()).rows).toHaveLength(6);
    expect((await list("320i")).matching).toBe(2);
    expect((await list("", OTHER)).rows).toHaveLength(0);

    const post = (form: Record<string, string>, shop = SHOP) =>
      run(
        routes.filterData.action,
        adminRequest(shop, "/app/filter-data", {
          method: "POST",
          body: { form },
        }),
      );
    const row = (make: string, years: string, model: string, sku: string) => ({
      [fieldIds.Make]: make,
      [fieldIds.Year]: years,
      [fieldIds.Model]: model,
      attachment: sku,
    });

    const added = await post({
      intent: "add",
      ...row("Audi", "2016-2019", "A3", "SP-300"),
    });
    expect(added.body).toMatchObject({ ok: true, toast: "Row added" });
    const invalid = await post({
      intent: "add",
      ...row("Audi", "2019-2016", "A3", "SP-300"),
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.fieldErrors?.[fieldIds.Year]).toBeTruthy();

    const a3 = (await list("A3")).rows[0];
    const edited = await post({
      intent: "edit",
      rowId: a3.id,
      ...row("Audi", "2016-2020", "A3", "SP-300"),
    });
    expect(edited.body).toMatchObject({ ok: true, toast: "Row updated" });
    expect((await list("A3")).rows[0]).toMatchObject({
      yearFrom: 2016,
      yearTo: 2020,
    });
    // Another shop can't edit or delete it.
    const foreignEdit = await post(
      { intent: "edit", rowId: a3.id, ...row("X", "2000", "Y", "Z") },
      OTHER,
    );
    expect(foreignEdit.body.ok).toBe(false);
    await post({ intent: "delete", ids: JSON.stringify([a3.id]) }, OTHER);
    expect((await list("A3")).rows).toHaveLength(1);
    expect((await list("A3")).rows[0].values[fieldIds.Make]).toBe("Audi");

    // An exact copy is refused; a copy in other case is a duplicate that Clean up removes.
    const copy = await post({
      intent: "add",
      ...row("Audi", "2016-2020", "A3", "SP-300"),
    });
    expect(copy.status).toBe(409);
    await post({ intent: "add", ...row("AUDI", "2016-2020", "a3", "SP-300") });
    expect((await post({ intent: "dedupe-count" })).body.duplicates).toBe(1);
    expect((await post({ intent: "dedupe" })).body.toast).toBe(
      "1 duplicate row removed",
    );

    const exported = await run(
      routes.exportCsv.action,
      adminRequest(SHOP, "/api/fitment/export", {
        method: "POST",
        body: { json: { scope: "all" } },
      }),
    );
    expect(exported.status).toBe(200);
    expect(exported.headers.get("x-row-count")).toBe("7");
    const lines = String(exported.body).replace(BOM, "").trim().split(/\r?\n/);
    expect(lines[0]).toBe("Make,Year,Model,Attachment");
    expect(lines).toHaveLength(8);
    expect(lines).toContain("Audi,2016-2020,A3,SP-300");

    const deleted = await post({
      intent: "delete",
      single: "1",
      ids: JSON.stringify([a3.id]),
    });
    expect(deleted.body.toast).toBe("Row deleted");
    expect((await list()).rows).toHaveLength(6);

    // Exported text a spreadsheet would run as a formula is defused ("Selected rows" export).
    await post({ intent: "add", ...row("Audi", "2020", "=1+1", "SP-300") });
    const formula = (await list("=1+1")).rows[0];
    const selected = await run(
      routes.exportCsv.action,
      adminRequest(SHOP, "/api/fitment/export", {
        method: "POST",
        body: { json: { scope: "selected", ids: [formula.id] } },
      }),
    );
    expect(String(selected.body)).toContain("Audi,2020,'=1+1,SP-300");
    await post({ intent: "delete", ids: JSON.stringify([formula.id]) });
    expect((await list()).rows).toHaveLength(6);
  });

  const mappingPage = async (shop = SHOP) =>
    (
      await run(
        routes.mapping.loader,
        adminRequest(shop, "/app/product-mapping"),
      )
    ).body;
  const linkCheckDone = (shop = SHOP) =>
    waitFor("link check", async () => {
      const res = await run(
        routes.linkStatus.loader,
        adminRequest(shop, "/api/links/status"),
      );
      if (res.body.status === "failed") {
        throw new Error(`link check failed: ${res.body.error}`);
      }
      return res.body.status === "completed" && res.body;
    });
  const mappingAction = (form: Record<string, string>, shop = SHOP) =>
    run(
      routes.mapping.action,
      adminRequest(shop, "/app/product-mapping", {
        method: "POST",
        body: { form },
      }),
    );

  it("product mapping shows the catalog the import's link check loaded, linked by SKU", async () => {
    // The first import queued a quick check; with no catalog yet it became a full one (bulk export).
    expect(
      shopify.operations.some(
        (o) => o.shop === SHOP && o.name === "CatalogBulkExport",
      ),
    ).toBe(true);

    const page = await mappingPage();
    expect(page.linkCheck.catalogReady).toBe(true);
    // BP-100, OF-200 and SP-300 matched variants; only the unknown SKU is left.
    expect(page.unlinkedCount).toBe(1);
    expect(
      page.unlinked.items.map((g: { attachment: string }) => g.attachment),
    ).toEqual(["NO-SUCH-SKU"]);
    const without = page.withoutData.items.map(
      (p: { title: string }) => p.title,
    );
    expect(without).toEqual(
      expect.arrayContaining(["Floor Mats", "Wiper Blades"]),
    );
    expect(without).not.toContain("Brake Pad Set");
    // The other shop sees none of it.
    const other = await mappingPage(OTHER);
    expect(other.unlinkedCount).toBe(0);
    expect(other.withoutData.items).toHaveLength(0);
  });

  it("product mapping links a SKU by hand, manages universal products and re-checks links", async () => {
    const linked = await mappingAction({
      intent: "link",
      attachment: "NO-SUCH-SKU",
      resourceId: catalog.wipers.id,
    });
    expect(linked.body).toMatchObject({
      ok: true,
      toast: "NO-SUCH-SKU linked to a product",
    });
    // A product of another store is read from THIS store's Admin API: not found, refused.
    const foreignProduct = shopify.addProduct(OTHER, {
      title: "Phone Case",
      skus: ["PC-1"],
    });
    const missing = await mappingAction({
      intent: "link",
      attachment: "NO-SUCH-SKU",
      resourceId: foreignProduct.id,
    });
    expect(missing.status).toBe(409);

    const universal = await mappingAction({
      intent: "universal-add",
      ids: JSON.stringify([catalog.mats.id]),
    });
    expect(universal.body).toMatchObject({
      ok: true,
      toast: "Floor Mats is now universal",
    });
    const again = await mappingAction({
      intent: "universal-mark",
      productId: catalog.mats.id,
    });
    expect(again.status).toBe(409);

    let page = await mappingPage();
    expect(page.unlinkedCount).toBe(0);
    expect(page.universal.items.map((p: { title: string }) => p.title)).toEqual(
      ["Floor Mats"],
    );

    const removed = await mappingAction({
      intent: "universal-remove",
      productId: catalog.mats.id,
    });
    expect(removed.body.toast).toBe("Floor Mats is no longer universal");
    expect(
      (
        await mappingAction({
          intent: "universal-mark",
          productId: catalog.mats.id,
        })
      ).body.ok,
    ).toBe(true);

    // Check links again, with a slow export and a throttled call on the way (retried).
    shopify.bulkRunningPolls = 1;
    shopify.throttleOnce.add("CatalogCollections");
    const before = shopify.operations.length;
    const check = await mappingAction({ intent: "check" });
    expect(check.body.ok).toBe(true);
    await linkCheckDone();
    const ops = shopify.operations.slice(before).map((o) => o.name);
    expect(ops.filter((n) => n === "BulkStatus").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(
      ops.filter((n) => n === "CatalogCollections").length,
    ).toBeGreaterThanOrEqual(2);
    expect(shopify.throttleOnce.size).toBe(0);
    shopify.bulkRunningPolls = 0;
    page = await mappingPage();
    // A full check keeps the manual link.
    expect(page.unlinkedCount).toBe(0);
  });

  it("products webhooks keep the catalog and links fresh", async () => {
    // The SKU changes in Shopify: its rows unlink after the product-sync job.
    catalog.plugs.variants[0].sku = "SP-300X";
    const update = await run(
      routes.productsWebhook.action,
      webhookRequest("/webhooks/products", SHOP, "products/update", {
        id: Number(catalog.plugs.id.split("/").pop()),
        admin_graphql_api_id: catalog.plugs.id,
      }),
    );
    expect(update.status).toBe(200);
    await waitFor("SP-300 unlinked", async () => {
      const page = await mappingPage();
      return page.unlinked.items.some(
        (g: { attachment: string }) => g.attachment === "SP-300",
      );
    });

    // And back: relinked by the next delivery.
    catalog.plugs.variants[0].sku = "SP-300";
    await run(
      routes.productsWebhook.action,
      webhookRequest("/webhooks/products", SHOP, "products/update", {
        id: Number(catalog.plugs.id.split("/").pop()),
        admin_graphql_api_id: catalog.plugs.id,
      }),
    );
    await waitFor(
      "SP-300 relinked",
      async () => (await mappingPage()).unlinkedCount === 0,
    );

    // A bad signature is refused before anything is queued.
    const forged = await run(
      routes.productsWebhook.action,
      webhookRequest(
        "/webhooks/products",
        SHOP,
        "products/update",
        { admin_graphql_api_id: catalog.plugs.id },
        { secret: "wrong" },
      ),
    );
    expect(forged.status).toBe(401);
  });

  it("storefront page reads the theme, publishes settings to the app metafield and saves changes", async () => {
    const page = await run(
      routes.storefront.loader,
      adminRequest(SHOP, "/app/storefront"),
    );
    expect(page.status).toBe(200);
    expect(page.body.themesError).toBeNull();
    expect(page.body.themes[0]).toMatchObject({
      name: "Horizon",
      role: "MAIN",
    });
    expect(page.body.status).toMatchObject({
      embedOn: true,
      blocks: { search: "index", badge: "product" },
    });
    expect(page.body.publishFailed).toBe(false);

    const published = () =>
      JSON.parse(shopify.shop(SHOP).appMetafields.get("fitfinder.config")!);
    expect(published().fields.map((f: { label: string }) => f.label)).toEqual([
      "Make",
      "Year",
      "Model",
    ]);

    const put = (body: unknown) =>
      run(
        routes.storefrontSettings.action,
        adminRequest(SHOP, "/api/storefront-settings", {
          method: "PUT",
          body: { json: body },
        }),
      );
    const saved = await put({
      intent: "setting",
      key: "button",
      value: JSON.stringify("Find my parts"),
    });
    expect(saved.body).toEqual({ ok: true, published: true });
    expect(JSON.stringify(published())).toContain("Find my parts");

    const heading = await put({ intent: "heading", value: "Shop by car" });
    expect(heading.body.ok).toBe(true);
    expect(JSON.stringify(published())).toContain("Shop by car");

    const bad = await put({
      intent: "setting",
      key: "layout",
      value: JSON.stringify("zigzag"),
    });
    expect(bad.status).toBe(400);
  });

  it("storefront proxy answers the theme's dropdowns, search, fits badge and results page", async () => {
    const get = (
      route: { loader: Parameters<typeof run>[0] },
      path: string,
      params: Record<string, string> = {},
      shop = SHOP,
    ) => run(route.loader, new Request(proxyUrl(shop, path, params)));
    const { Make, Year, Model } = fieldIds;

    const makes = await get(routes.proxyOptions, "options", { field: Make });
    expect(makes.status).toBe(200);
    expect(makes.body.options).toEqual(["Audi", "BMW", "Ford"]);
    const years = await get(routes.proxyOptions, "options", {
      field: Year,
      [Make]: "Audi",
    });
    expect(years.body.options).toEqual(
      expect.arrayContaining(["2008", "2011", "2015"]),
    );
    expect(years.body.options).not.toContain("2016");
    const models = await get(routes.proxyOptions, "options", {
      field: Model,
      [Make]: "Audi",
      [Year]: "2010",
    });
    expect(models.body.options).toEqual(["A4", "A6"]);

    const picks = { [Make]: "Audi", [Year]: "2010", [Model]: "A4" };
    const search = await get(routes.proxySearch, "search", picks);
    // The fitting part plus the universal Floor Mats.
    expect(search.body).toMatchObject({ mode: "search", skus: 2 });
    expect(search.body.q).toContain("FM-1");
    expect(search.body.q).toContain("BP-100");
    const nothing = await get(routes.proxySearch, "search", {
      ...picks,
      [Year]: "1999",
    });
    // Nothing fits 1999: only the universal product is searched.
    expect(nothing.body).toMatchObject({
      mode: "search",
      skus: 1,
      q: 'variants.sku:"FM-1"',
    });

    const numeric = (gid: string) => gid.split("/").pop()!;
    const fits = await get(routes.proxyFits, "fits", {
      product: numeric(catalog.brakes.id),
      ...picks,
    });
    expect(fits.body).toMatchObject({ state: "fits", total: 2 });
    const noFit = await get(routes.proxyFits, "fits", {
      product: numeric(catalog.oil.id),
      ...picks,
    });
    expect(noFit.body.state).toBe("no-fit");
    const universal = await get(routes.proxyFits, "fits", {
      product: numeric(catalog.mats.id),
      ...picks,
    });
    expect(universal.body).toMatchObject({ state: "fits", universal: true });

    const results = await get(routes.proxyResults, "results", picks);
    expect(results.status).toBe(200);
    expect(results.headers.get("content-type")).toContain("application/liquid");
    // Liquid that renders the theme's own cards, by product handle.
    expect(String(results.body)).toContain("all_products['brake-pad-set']");
    expect(String(results.body)).toContain("all_products['floor-mats']");
    expect(String(results.body)).not.toContain("oil-filter");

    // Signature checks: forged, stale, or another shop's data.
    const forged = await run(
      routes.proxyOptions.loader,
      new Request(proxyUrl(SHOP, "options", { field: Make }, { secret: "x" })),
    );
    expect(forged.status).toBe(400);
    const stale = await run(
      routes.proxyOptions.loader,
      new Request(
        proxyUrl(
          SHOP,
          "options",
          { field: Make },
          { timestamp: Math.floor(Date.now() / 1000) - 600 },
        ),
      ),
    );
    expect(stale.status).toBe(400);
    const otherShop = await get(
      routes.proxyOptions,
      "options",
      { field: Make },
      OTHER,
    );
    expect(otherShop.status).toBe(400); // not one of the phone shop's field ids
    const unknownShop = await get(
      routes.proxyOptions,
      "options",
      { field: Make },
      `nobody-${RUN}.myshopify.com`,
    );
    expect(unknownShop.status).toBe(404);
    // The other shop asking about this shop's product with this shop's field ids: nothing.
    const otherFits = await get(
      routes.proxyFits,
      "fits",
      { product: numeric(catalog.brakes.id), ...picks },
      OTHER,
    );
    expect(otherFits.body).toMatchObject({ state: "ask", total: 0, rows: [] });
    const otherSearch = await get(routes.proxySearch, "search", picks, OTHER);
    expect(otherSearch.status).toBe(400);
  });

  it("dashboard shows the real setup state", async () => {
    const res = await run(routes.dashboard.loader, adminRequest(SHOP, "/app"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      storeType: "automotive",
      noun: "vehicle",
      fieldNames: ["Make", "Year", "Model"],
    });
    const details = await res.body.details;
    expect(details.facts).toMatchObject({
      rowCount: 6,
      skus: 4,
      unlinkedSkus: 0,
      embedOn: true,
      plan: "none",
      planChosen: false,
    });
    expect(details.facts.coverage).toEqual(
      expect.arrayContaining([{ label: "Make", count: 3 }]),
    );
    expect(details.over).toEqual([]);
  });

  it("plans read Shopify App Pricing and the limits follow the plan", async () => {
    const { clearPlanCache } = await import("../services/billing.server");
    const plans = async () =>
      (await run(routes.plans.loader, adminRequest(SHOP, "/app/plans"))).body;

    let page = await plans();
    expect(page).toMatchObject({
      plan: "none",
      chosen: false,
      connected: true,
    });
    expect(page.planUrl).toContain(`/charges/${"fitfinder"}/pricing_plans`);
    expect(page.used).toEqual({ rows: 6, products: 5 });

    // Starter (also what "no plan" gets): 50 products with filter data at most.
    const extra = Array.from({ length: 46 }, (_, i) =>
      shopify.addProduct(SHOP, { title: `Seat Cover ${i}`, skus: [`SC-${i}`] }),
    );
    const refused = await mappingAction({
      intent: "universal-add",
      ids: JSON.stringify(extra.map((p) => p.id)),
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain("50");

    // The merchant picks Growth on Shopify's plan page and comes back.
    shopify.shop(SHOP).subscription = {
      handles: ["growth"],
      trialEndsAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    };
    clearPlanCache();
    page = await plans();
    expect(page).toMatchObject({ plan: "growth", chosen: true, trialDays: 7 });
    const allowed = await mappingAction({
      intent: "universal-add",
      ids: JSON.stringify(extra.map((p) => p.id)),
    });
    expect(allowed.body).toMatchObject({
      ok: true,
      toast: "46 products added to universal products",
    });
    // The other shop's plan didn't change.
    clearPlanCache();
    expect((await plans()).plan).toBe("growth");
    const other = (
      await run(routes.plans.loader, adminRequest(OTHER, "/app/plans"))
    ).body;
    expect(other.plan).toBe("none");
  });

  it("settings shows the store type, and replacing a store type resets only that shop", async () => {
    const settings = await run(
      routes.settings.loader,
      adminRequest(SHOP, "/app/settings"),
    );
    expect(settings.body.storeTypeLabel).toBe("Automotive");

    const replaced = await run(
      routes.onboarding.action,
      adminRequest(OTHER, "/app/onboarding", {
        method: "POST",
        body: { form: { storeType: "beauty", replace: "true" } },
      }),
    );
    expect(replaced.status).toBe(302);
    const otherFields = await prisma.searchField.findMany({
      where: { shop: { domain: OTHER } },
      orderBy: { position: "asc" },
    });
    expect(otherFields.map((f) => f.label)).toEqual([
      "Brand",
      "Product type",
      "Gender",
    ]);
    expect(await prisma.fitmentRow.count({ where: { shopId } })).toBe(6);
  });

  it("uninstall stops the storefront, compliance webhooks answer, and the purge deletes the shop", async () => {
    const { purgeUninstalledShops } = await import("../services/purge.server");
    const forged = await run(
      routes.uninstalled.action,
      webhookRequest(
        "/webhooks/app/uninstalled",
        SHOP,
        "app/uninstalled",
        {},
        { secret: "wrong" },
      ),
    );
    expect(forged.status).toBe(401);

    const res = await run(
      routes.uninstalled.action,
      webhookRequest("/webhooks/app/uninstalled", SHOP, "app/uninstalled", {
        domain: SHOP,
      }),
    );
    expect(res.status).toBe(200);
    expect(await prisma.session.count({ where: { shop: SHOP } })).toBe(0);
    const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(shop.uninstalledAt).not.toBeNull();

    // The theme's blocks stop getting data.
    const proxy = await run(
      routes.proxyOptions.loader,
      new Request(proxyUrl(SHOP, "options", { field: fieldIds.Make })),
    );
    expect(proxy.status).toBe(404);

    for (const topic of [
      "customers/data_request",
      "customers/redact",
      "shop/redact",
    ]) {
      const ok = await run(
        routes.compliance.action,
        webhookRequest("/webhooks/compliance", SHOP, topic, {
          shop_domain: SHOP,
        }),
      );
      expect(ok.status).toBe(200);
      const bad = await run(
        routes.compliance.action,
        webhookRequest(
          "/webhooks/compliance",
          SHOP,
          topic,
          { shop_domain: SHOP },
          { secret: "wrong" },
        ),
      );
      expect(bad.status).toBe(401);
    }

    // A reinstall within 30 days finds everything as it was, and the purge leaves it alone.
    const back = await run(routes.layout.loader, adminRequest(SHOP, "/app"));
    expect(back.status).toBe(200);
    expect(
      (await prisma.shop.findUniqueOrThrow({ where: { id: shopId } }))
        .uninstalledAt,
    ).toBeNull();
    expect(await prisma.fitmentRow.count({ where: { shopId } })).toBe(6);
    const later = new Date(Date.now() + 31 * 86400_000);
    expect(await purgeUninstalledShops(later, { only: [SHOP] })).toBe(0);

    // Uninstalled again; data is kept for 30 days, then purged.
    const again = await run(
      routes.uninstalled.action,
      webhookRequest(
        "/webhooks/app/uninstalled",
        SHOP,
        "app/uninstalled",
        { domain: SHOP },
        { triggeredAt: new Date(Date.now() + 1000) },
      ),
    );
    expect(again.status).toBe(200);
    expect(existsSync(path.join(storageDir, "imports", shopId))).toBe(true);
    expect(await purgeUninstalledShops(new Date(), { only: [SHOP] })).toBe(0);
    expect(await purgeUninstalledShops(later, { only: [SHOP] })).toBe(1);
    expect(await prisma.shop.findUnique({ where: { id: shopId } })).toBeNull();
    expect(await prisma.fitmentRow.count({ where: { shopId } })).toBe(0);
    expect(await prisma.importJob.count({ where: { shopId } })).toBe(0);
    expect(existsSync(path.join(storageDir, "imports", shopId))).toBe(false);
    // The other shop is untouched.
    expect(
      await prisma.shop.count({
        where: { domain: OTHER, uninstalledAt: null },
      }),
    ).toBe(1);
  });

  it("a reinstall after the purge starts again at onboarding", async () => {
    const res = await run(routes.layout.loader, adminRequest(SHOP, "/app"));
    expect(res.status).toBe(302);
    expect(res.location).toContain("/app/onboarding");
    const shop = await prisma.shop.findUniqueOrThrow({
      where: { domain: SHOP },
    });
    expect(shop.id).not.toBe(shopId);
    expect(shop.plan).toBe("none");
  });

  it("never sent a request the fake Shopify didn't know", () => {
    expect(shopify.unknown).toEqual([]);
  });
});
