// End-to-end merchant journey across every feature, against the real Postgres, real pg-boss jobs
// and the library's own auth, with Shopify faked at the HTTP boundary (fake-shopify.ts):
// install → onboarding → search setup → CSV import → filter data → product mapping and linking →
// products webhook → storefront settings and theme status → storefront proxy (options, search,
// fits, results), theme status, live preview and icon upload → analytics → dashboard → plans (Billing API) and the backoffice → settings → uninstall,
// compliance webhooks and purge.
// A second shop runs alongside to prove tenant isolation at each step.
import {
  adminRequest,
  BACKOFFICE,
  cleanLeftovers,
  removeStorage,
  run,
  shopify,
  stopJobs,
  storageDir,
  seedPlansForRun,
  waitFor,
} from "./harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  APP_URL,
  proxyUrl,
  SCOPES,
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
  boLogin: await import("../routes/backoffice_.login"),
  boPlans: await import("../routes/backoffice.plans._index"),
  boOverview: await import("../routes/backoffice._index"),
  boStores: await import("../routes/backoffice.stores"),
  boLogs: await import("../routes/backoffice.logs"),
  boPlan: await import("../routes/backoffice.plans.$key"),
  boProfile: await import("../routes/backoffice.profile"),
  subscriptionsWebhook:
    await import("../routes/webhooks.app.subscriptions_update"),
  settings: await import("../routes/app.settings"),
  uninstalled: await import("../routes/webhooks.app.uninstalled"),
  compliance: await import("../routes/webhooks.compliance"),
  analytics: await import("../routes/app.analytics"),
  storefrontIcon: await import("../routes/api.storefront-icon"),
  storefrontPreview: await import("../routes/api.storefront-preview"),
  themeStatus: await import("../routes/api.themes.$id"),
  scopesWebhook: await import("../routes/webhooks.app.scopes_update"),
  boLayout: await import("../routes/backoffice"),
  boLogout: await import("../routes/backoffice_.logout"),
  landing: await import("../routes/_index/route"),
};

const BLOCK = (handle: string) =>
  `shopify://apps/sparefit/blocks/${handle}/0199e2e0-0000-7000-8000-000000000000`;
const THEME_FILES = {
  "config/settings_data.json": JSON.stringify({
    current: {
      blocks: { embed1: { type: BLOCK("sparefit-embed"), disabled: false } },
    },
  }),
  "templates/index.json": JSON.stringify({
    sections: {
      sp: {
        type: "_blocks",
        blocks: { s: { type: BLOCK("sparefit-search"), settings: {} } },
      },
    },
  }),
  "templates/product.json": JSON.stringify({
    sections: {
      main: {
        type: "main-product",
        blocks: { b: { type: BLOCK("sparefit-fits-badge"), settings: {} } },
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

describe("SpareFit end to end", () => {
  let shopId: string;
  const fieldIds: Record<string, string> = {};
  const catalog = {} as Record<
    "brakes" | "oil" | "plugs" | "mats" | "wipers" | "draft",
    FakeProduct
  >;

  let restorePlans: () => Promise<void> = async () => {};

  beforeAll(async () => {
    await cleanLeftovers();
    restorePlans = await seedPlansForRun();
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
    shopify.addTheme(SHOP, {
      name: "Horizon",
      role: "MAIN",
      files: THEME_FILES,
    });
    shopify.addTheme(SHOP, { name: "Dawn", role: "UNPUBLISHED", files: {} });
  });

  afterAll(async () => {
    await restorePlans();
    await stopJobs();
    await prisma.session.deleteMany({ where: { shop: { in: [SHOP, OTHER] } } });
    await prisma.shop.deleteMany({ where: { domain: { in: [SHOP, OTHER] } } });
    await prisma.appLog.deleteMany({
      where: { shopDomain: { in: [SHOP, OTHER] } },
    });
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

    // Without any admin page visit, a background job gives the theme the new first dropdown
    // values (app metafield sparefit.first), so the search widget fills it without asking the app.
    const first = await waitFor("first dropdown published", async () => {
      const value = shopify.shop(SHOP).appMetafields.get("sparefit.first");
      const doc = value && JSON.parse(value);
      return doc?.v?.length > 0 && doc;
    });
    const make = await prisma.searchField.findFirst({
      where: { shopId },
      orderBy: { position: "asc" },
    });
    expect(first).toEqual({ f: make!.id, v: ["Audi", "BMW", "Ford"] });

    // The history entry and the error report.
    expect(done.hasReport).toBe(true);
    // Filter data › Import shows it (the import moved there from Search setup).
    const filterPage = await run(
      routes.filterData.loader,
      adminRequest(SHOP, "/app/filter-data"),
    );
    expect(filterPage.body.counts.total).toBe(6);
    expect(filterPage.body.history[0]).toMatchObject({
      id: jobId,
      mode: "upsert",
    });

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
    expect(lines[0]).toBe("Make,Year,Model,SKU");
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
  const plansAction = (form: Record<string, string>, shop = SHOP) =>
    run(
      routes.plans.action,
      adminRequest(shop, "/app/plans", { method: "POST", body: { form } }),
    );
  /** The merchant picks a paid plan, approves the charge on Shopify's page and comes back. */
  const pickPlan = async (shop: string, plan: string, interval = "monthly") => {
    const started = await plansAction(
      { intent: "subscribe", plan, interval },
      shop,
    );
    expect(started.body).toMatchObject({ ok: true });
    expect(started.body.confirmationUrl).toContain("/admin/charges/confirm");
    const charge = shopify.approveCharge(shop);
    // Shopify sends the merchant back to the Plans page (returnUrl), which reads the plan fresh.
    const { clearPlanCache } = await import("../services/billing.server");
    clearPlanCache();
    const page = (
      await run(routes.plans.loader, adminRequest(shop, "/app/plans?charge=1"))
    ).body;
    expect(page).toMatchObject({ plan, chosen: true });
    return { charge, page };
  };

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

  it("product mapping replaces an unknown SKU by a chosen product's, manages universal products and re-checks links", async () => {
    const linked = await mappingAction({
      intent: "link",
      attachment: "NO-SUCH-SKU",
      resourceId: catalog.wipers.id,
    });
    expect(linked.body).toMatchObject({
      ok: true,
      toast: "NO-SUCH-SKU replaced by WB-9 (Wiper Blades)",
    });
    // The Ford row now carries the store SKU.
    expect(
      await prisma.fitmentRow.count({ where: { shopId, attachment: "WB-9" } }),
    ).toBe(1);
    // A product of another store is read from THIS store's Admin API: not found, refused.
    const foreignProduct = shopify.addProduct(OTHER, {
      title: "Phone Case",
      skus: ["PC-1"],
    });
    const missing = await mappingAction({
      intent: "link",
      attachment: "WB-9",
      resourceId: foreignProduct.id,
    });
    expect(missing.status).toBe(409);

    const notIncluded = await mappingAction({
      intent: "universal-add",
      ids: JSON.stringify([catalog.mats.id]),
    });
    expect(notIncluded.status).toBe(409);
    expect(notIncluded.body.error).toContain(
      "Universal products isn't included in the Starter plan",
    );
    await pickPlan(SHOP, "growth");

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
    shopify.throttleOnce.add("CatalogBulkExport");
    const before = shopify.operations.length;
    const check = await mappingAction({ intent: "check" });
    expect(check.body.ok).toBe(true);
    await linkCheckDone();
    const ops = shopify.operations.slice(before).map((o) => o.name);
    expect(ops.filter((n) => n === "BulkStatus").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(
      ops.filter((n) => n === "CatalogBulkExport").length,
    ).toBeGreaterThanOrEqual(2);
    expect(shopify.throttleOnce.size).toBe(0);
    shopify.bulkRunningPolls = 0;
    page = await mappingPage();
    // A full check keeps the link: WB-9 is a store SKU now.
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
      JSON.parse(shopify.shop(SHOP).appMetafields.get("sparefit.config")!);
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

  it("storefront page checks a theme, runs the live preview and uploads a My Selection icon", async () => {
    const numeric = (gid: string) => gid.split("/").pop()!;
    const [horizon, dawn] = shopify.shop(SHOP).themes;

    // Theme status (picking a theme, coming back from the editor).
    const status = (id: string, shop = SHOP) =>
      run(routes.themeStatus.loader, adminRequest(shop, `/api/themes/${id}`), {
        id,
      });
    const live = await status(numeric(horizon.id));
    expect(live.status).toBe(200);
    expect(live.body.status).toMatchObject({
      embedOn: true,
      blocks: { search: "index", badge: "product" },
    });
    const draft = await status(numeric(dawn.id));
    expect(draft.body.status).toMatchObject({ embedOn: false });
    expect((await status("not-a-number")).status).toBe(400);
    expect((await status("999999999")).status).toBe(404);
    // Another shop can't read this shop's theme.
    expect((await status(numeric(horizon.id), OTHER)).status).toBe(404);

    // Live preview: the storefront scripts' proxy calls, with the admin session.
    const { Make, Year, Model } = fieldIds;
    const preview = (params: Record<string, string>, shop = SHOP) =>
      run(
        routes.storefrontPreview.loader,
        adminRequest(
          shop,
          `/api/storefront-preview?${new URLSearchParams(params)}`,
        ),
      );
    const makes = await preview({ path: "options", field: Make });
    expect(makes.body.options).toEqual(["Audi", "BMW", "Ford"]);
    const models = await preview({
      path: "options",
      field: Model,
      [Make]: "Audi",
      [Year]: "2010",
    });
    expect(models.body.options).toEqual(["A4", "A6"]);
    const results = await preview({
      path: "results",
      [Make]: "Audi",
      [Year]: "2010",
      [Model]: "A4",
    });
    expect(results.status).toBe(200);
    expect(results.body.total).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(results.body.titles)).toContain("Brake Pad Set");
    const incomplete = await preview({ path: "results", [Make]: "Audi" });
    expect(incomplete.body).toEqual({ titles: [], total: 0 });
    expect((await preview({ path: "nope" })).status).toBe(400);
    expect((await preview({ path: "options", field: "x" })).status).toBe(400);
    // This shop's field ids mean nothing to the other shop.
    expect(
      (await preview({ path: "options", field: Make }, OTHER)).status,
    ).toBe(400);

    // My Selection custom icon: checked, uploaded to Shopify Files, saved and published.
    const upload = async (bytes: Uint8Array, name: string, type: string) => {
      const form = new FormData();
      form.append("file", new Blob([bytes as BlobPart], { type }), name);
      const encoded = new Response(form);
      const body = new Uint8Array(await encoded.arrayBuffer());
      return run(
        routes.storefrontIcon.action,
        new Request(`${APP_URL}/api/storefront-icon`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sessionToken(SHOP)}`,
            "Content-Type": encoded.headers.get("content-type")!,
            "Content-Length": String(body.length),
          },
          body,
        }),
      );
    };
    const png = (w: number, h: number) => {
      const bytes = new Uint8Array(33);
      bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const view = new DataView(bytes.buffer);
      view.setUint32(8, 13);
      bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
      view.setUint32(16, w);
      view.setUint32(20, h);
      return bytes;
    };
    const wide = await upload(png(96, 48), "wide.png", "image/png");
    expect(wide.status).toBe(400);
    expect(wide.body.error).toContain("square");
    const script = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script></svg>',
    );
    const unsafe = await upload(script, "icon.svg", "image/svg+xml");
    expect(unsafe.status).toBe(400);
    expect(unsafe.body.error).toContain("scripts");

    const ok = await upload(png(64, 64), "icon.png", "image/png");
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ published: true });
    expect(ok.body.url).toMatch(/^https:\/\/cdn\.shopify\.com\//);
    const saved = await prisma.storefrontSettings.findUniqueOrThrow({
      where: { shopId },
    });
    expect(saved.settings).toMatchObject({
      savedIcon: "custom",
      savedIconUrl: ok.body.url,
    });
    expect(shopify.shop(SHOP).appMetafields.get("sparefit.config")).toContain(
      ok.body.url,
    );
  });

  it("analytics shows what shoppers searched, what found nothing and the fits badge checks", async () => {
    const { Make, Year, Model } = fieldIds;
    const analytics = async (shop = SHOP, query = "") =>
      (
        await run(
          routes.analytics.loader,
          adminRequest(shop, `/app/analytics${query}`),
        )
      ).body;

    // A selection that has a filter row but no product in the store: "found nothing".
    const post = (form: Record<string, string>) =>
      run(
        routes.filterData.action,
        adminRequest(SHOP, "/app/filter-data", {
          method: "POST",
          body: { form },
        }),
      );
    const tesla = { [Make]: "Tesla", [Year]: "2022", [Model]: "Model 3" };
    const added = await post({ intent: "add", ...tesla, attachment: "ZZ-404" });
    expect(added.body.ok).toBe(true);
    const search = (picks: Record<string, string>) =>
      run(
        routes.proxySearch.loader,
        new Request(proxyUrl(SHOP, "search", picks)),
      );
    expect((await search(tesla)).status).toBe(200);
    // A made-up selection (no filter row) is not counted.
    await search({ [Make]: "Nobody", [Year]: "2022", [Model]: "X" });

    // The storefront proxy journey searched Audi 2010 A4 and checked three products.
    const page = await waitFor("the searches to be counted", async () => {
      const body = await analytics();
      return body.report.searches >= 2 && body.report.noResults >= 1 && body;
    });
    expect(page.days).toBe(30);
    expect(page.report.hasData).toBe(true);
    expect(page.report).toMatchObject({ searches: 2, noResults: 1 });
    expect(page.selectionHeader).toBe("Make › Year › Model");
    expect(
      page.report.topSelections.map((s: { label: string }) => s.label),
    ).toEqual(
      expect.arrayContaining(["Audi › 2010 › A4", "Tesla › 2022 › Model 3"]),
    );
    expect(page.report.nothingFound).toEqual([
      expect.objectContaining({
        label: "Tesla › 2022 › Model 3",
        foundNow: false,
      }),
    ]);
    expect(page.report.fits).toBeGreaterThanOrEqual(1);
    expect(page.report.noFit).toBeGreaterThanOrEqual(1);
    expect(page.report.products.map((p: { title: string }) => p.title)).toEqual(
      expect.arrayContaining(["Brake Pad Set", "Oil Filter"]),
    );
    expect(page.values.length).toBeGreaterThan(0);
    // The period comes from the URL; an unknown one falls back to 30 days.
    expect((await analytics(SHOP, "?days=7")).days).toBe(7);
    expect((await analytics(SHOP, "?days=999")).days).toBe(30);
    // The other shop's shoppers searched nothing.
    expect((await analytics(OTHER)).report.hasData).toBe(false);

    // Put the rows back as they were for the next journeys.
    const rows = (
      await run(
        routes.fitment.loader,
        adminRequest(SHOP, `/api/fitment?q=Tesla&pageSize=10`),
      )
    ).body.rows as { id: string }[];
    expect(rows).toHaveLength(1);
    await post({
      intent: "delete",
      ids: JSON.stringify(rows.map((r) => r.id)),
    });
    expect(await prisma.fitmentRow.count({ where: { shopId } })).toBe(6);
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
      // Picked during product mapping (universal products need Growth).
      planName: "Growth",
      planChosen: true,
    });
    expect(details.facts.coverage).toEqual(
      expect.arrayContaining([{ label: "Make", count: 3 }]),
    );
    expect(details.over).toEqual([]);
  });

  it("plans run on the Billing API, the backoffice sets price, trial and features, and limits follow the plan", async () => {
    const { clearPlanCache } = await import("../services/billing.server");
    const { getPlan, updatePlan, clearPlansCache } =
      await import("../models/plan.server");
    const plans = async (shop = SHOP) =>
      (await run(routes.plans.loader, adminRequest(shop, "/app/plans"))).body;

    // Growth was picked during product mapping: 14-day trial, $29 a month.
    let page = await plans();
    expect(page).toMatchObject({ plan: "growth", chosen: true, trialDays: 14 });
    expect(page.used).toEqual({ rows: 6, products: 5 });
    const first = shopify.shop(SHOP).charges[0];
    expect(first.variables).toMatchObject({
      trialDays: 14,
      test: true,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: 29, currencyCode: "USD" },
              interval: "EVERY_30_DAYS",
            },
          },
        },
      ],
    });

    // Back to the free plan: the charge is cancelled, Starter's limits apply.
    const free = await plansAction({ intent: "free", plan: "starter" });
    expect(free.body).toMatchObject({ ok: true, toast: "Plan changed" });
    expect(first.status).toBe("CANCELLED");
    clearPlanCache();
    page = await plans();
    expect(page).toMatchObject({ plan: "starter", chosen: true });
    const extra = Array.from({ length: 46 }, (_, i) =>
      shopify.addProduct(SHOP, { title: `Seat Cover ${i}`, skus: [`SC-${i}`] }),
    );
    const refused = await mappingAction({
      intent: "universal-add",
      ids: JSON.stringify(extra.map((p) => p.id)),
    });
    expect(refused.status).toBe(409);

    // The super admin signs in to the backoffice and changes Growth: $39, 7-day trial.
    const original = (await getPlan("growth"))!;
    const origin = "https://app.e2e.test";
    const bo = (path: string, form?: Record<string, string>, cookie = "") =>
      new Request(`${origin}${path}`, {
        method: form ? "POST" : "GET",
        headers: {
          Origin: origin,
          Host: "app.e2e.test",
          Cookie: cookie,
          ...(form
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
        },
        body: form ? new URLSearchParams(form) : undefined,
      });
    const wrong = await run(
      routes.boLogin.action,
      bo("/backoffice/login", { email: BACKOFFICE.email, password: "nope" }),
    );
    expect(wrong.status).toBe(401);
    // Not signed in: the plans list sends to the sign-in page.
    expect(
      (await run(routes.boPlans.loader, bo("/backoffice/plans"))).location,
    ).toBe("/backoffice/login");
    const login = await run(
      routes.boLogin.action,
      bo("/backoffice/login", {
        email: BACKOFFICE.email,
        password: BACKOFFICE.password,
      }),
    );
    expect(login.location).toBe("/backoffice");
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookie).toMatch(/^__sparefit_bo=/);
    // A post from another site is refused even with the cookie.
    const forged = await run(
      routes.boPlan.action,
      new Request(`${origin}/backoffice/plans/growth`, {
        method: "POST",
        headers: {
          Origin: "https://evil.test",
          Host: "app.e2e.test",
          Cookie: cookie,
        },
        body: new URLSearchParams({ name: "Hacked" }),
      }),
      { key: "growth" },
    );
    expect(forged.status).toBe(403);

    try {
      const form: Record<string, string> = {
        name: "Growth",
        description: original.description,
        visible: "on",
        priceMonthly: "39",
        priceYearly: "390",
        trialDays: "7",
        "limit.rows": "500000",
        "limit.products": "5000",
        "toggle.fitsBadge": "on",
        "toggle.fitmentTable": "on",
        "toggle.mySelection": "on",
        "toggle.universalProducts": "on",
        "toggle.importBackups": "on",
        "line.text": "Everything in Starter",
        "line.at": "0",
      };
      const bad = await run(
        routes.boPlan.action,
        bo("/backoffice/plans/growth", { ...form, priceMonthly: "0" }, cookie),
        { key: "growth" },
      );
      expect(bad.status).toBe(400);
      expect(bad.body.errors.priceMonthly).toContain("monthly price");
      // Import backups is a plain switch (no number): saving it off works.
      const withoutBackups = { ...form };
      delete withoutBackups["toggle.importBackups"];
      const savedOff = await run(
        routes.boPlan.action,
        bo("/backoffice/plans/growth", withoutBackups, cookie),
        { key: "growth" },
      );
      expect(savedOff.location).toBe("/backoffice/plans?saved=growth");
      const offPlan = (
        await run(
          routes.boPlans.loader,
          bo("/backoffice/plans", undefined, cookie),
        )
      ).body.plans.find((p: { key: string }) => p.key === "growth");
      expect(offPlan.toggles.importBackups).toBe(false);
      expect(offPlan.limits).toEqual({ rows: 500000, products: 5000 });
      const saved = await run(
        routes.boPlan.action,
        bo("/backoffice/plans/growth", form, cookie),
        { key: "growth" },
      );
      expect(saved.location).toBe("/backoffice/plans?saved=growth");
      const list = (
        await run(
          routes.boPlans.loader,
          bo("/backoffice/plans", undefined, cookie),
        )
      ).body;
      // The Overview counts this run's shops (others may exist in the dev database).
      const overview = (
        await run(
          routes.boOverview.loader,
          bo("/backoffice", undefined, cookie),
        )
      ).body.stats;
      expect(overview.stores.installed).toBeGreaterThanOrEqual(2);
      expect(overview.stores.installsByDay).toHaveLength(30);
      expect(
        overview.activity.some(
          (a: { domain: string; kind: string }) =>
            a.domain === SHOP && a.kind === "install",
        ),
      ).toBe(true);
      // Stores page: every store with its plan, search fields and usage; filters in the URL.
      expect(
        (await run(routes.boStores.loader, bo("/backoffice/stores"))).location,
      ).toBe("/backoffice/login");
      const stores = async (query: string) =>
        (
          await run(
            routes.boStores.loader,
            bo(`/backoffice/stores?${query}`, undefined, cookie),
          )
        ).body;
      const mine = await stores(`q=${RUN}&sort=domain`);
      expect(mine.stores.total).toBe(2);
      expect(
        mine.stores.stores.map((st: { domain: string }) => st.domain),
      ).toEqual([SHOP, OTHER]);
      expect(mine.stores.stores[0]).toMatchObject({
        domain: SHOP,
        storeType: "automotive",
        plan: "starter",
        planName: "Starter",
        fields: ["Make", "Year", "Model"],
        rows: 6,
        searches30: 2,
        uninstalledAt: null,
      });
      expect(mine.stores.stores[0].linkedSkus).toBeGreaterThanOrEqual(1);
      expect(mine.stores.stores[1]).toMatchObject({
        domain: OTHER,
        storeType: "phones",
        rows: 0,
        searches30: 0,
      });
      const starter = await stores(`q=${RUN}&plan=starter`);
      expect(
        starter.stores.stores.map((st: { domain: string }) => st.domain),
      ).toEqual([SHOP]);
      expect((await stores(`q=${RUN}&status=uninstalled`)).stores.total).toBe(
        0,
      );
      // Odd values fall back; a page past the end shows the last page.
      const odd = await stores(
        `q=${RUN}&plan=nope&status=zzz&sort=x&size=7&page=99`,
      );
      expect(odd.filters).toMatchObject({
        plan: "all",
        status: "installed",
        sort: "newest",
        pageSize: 10,
        page: 1,
      });
      expect(odd.stores.stores).toHaveLength(2);
      const paged = await stores(`q=${RUN}&size=10&page=1`);
      expect(paged.stores).toMatchObject({ page: 1, pageSize: 10, total: 2 });
      expect(
        (await run(routes.boOverview.loader, bo("/backoffice"))).location,
      ).toBe("/backoffice/login");
      expect(
        list.plans.find((p: { key: string }) => p.key === "growth"),
      ).toMatchObject({
        priceMonthly: 39,
        trialDays: 7,
        // The own line saved at the top of the card.
        bullets: ["Everything in Starter"],
        bulletsAt: [0],
      });

      // The merchant sees the new price and trial, and the new charge uses them.
      page = await plans();
      expect(
        page.plans.find((p: { key: string }) => p.key === "growth"),
      ).toMatchObject({ priceMonthly: 39, trialDays: 7 });
      const { charge } = await pickPlan(SHOP, "growth");
      // 7-day trial minus the started day already spent on the earlier Growth trial.
      expect(charge.variables).toMatchObject({
        trialDays: 6,
        lineItems: [
          { plan: { appRecurringPricingDetails: { price: { amount: 39 } } } },
        ],
      });

      // The charge status webhook is recorded.
      const hook = await run(
        routes.subscriptionsWebhook.action,
        webhookRequest(
          "/webhooks/app/subscriptions_update",
          SHOP,
          "app_subscriptions/update",
          {
            app_subscription: {
              admin_graphql_api_id: charge.id,
              status: "ACTIVE",
            },
          },
        ),
      );
      expect(hook.status).toBe(200);
      expect(
        await prisma.appSubscription.findUniqueOrThrow({
          where: { shopifyId: charge.id },
        }),
      ).toMatchObject({ status: "ACTIVE", planKey: "growth" });

      // Growth includes universal products and 5,000 products.
      const allowed = await mappingAction({
        intent: "universal-add",
        ids: JSON.stringify(extra.map((p) => p.id)),
      });
      expect(allowed.body).toMatchObject({
        ok: true,
        toast: "46 products added to universal products",
      });
    } finally {
      await updatePlan("growth", { ...original }, "e2e-restore");
      clearPlansCache();
    }

    // The other shop's plan didn't change.
    expect((await plans(OTHER)).plan).toBe("none");
  });

  it("backoffice profile: the admin changes name and password; other sessions are signed out", async () => {
    const origin = "https://app.e2e.test";
    const bo = (path: string, form?: Record<string, string>, cookie = "") =>
      new Request(`${origin}${path}`, {
        method: form ? "POST" : "GET",
        headers: {
          Origin: origin,
          Host: "app.e2e.test",
          Cookie: cookie,
          ...(form
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
        },
        body: form ? new URLSearchParams(form) : undefined,
      });
    const signIn = async (password: string) => {
      const res = await run(
        routes.boLogin.action,
        bo("/backoffice/login", { email: BACKOFFICE.email, password }),
      );
      return {
        status: res.status,
        cookie: (res.headers.get("set-cookie") ?? "").split(";")[0],
      };
    };
    await prisma.backofficeAdmin.deleteMany({});
    try {
      const first = await signIn(BACKOFFICE.password);
      expect(first.status).toBe(302);
      const page = await run(
        routes.boProfile.loader,
        bo("/backoffice/profile", undefined, first.cookie),
      );
      expect(page.body).toMatchObject({
        email: BACKOFFICE.email,
        fromEnv: true,
      });

      const save = (form: Record<string, string>) =>
        run(
          routes.boProfile.action,
          bo("/backoffice/profile", form, first.cookie),
        );
      const base = {
        name: "Owner",
        email: BACKOFFICE.email,
        currentPassword: BACKOFFICE.password,
        newPassword: "",
        confirmPassword: "",
      };
      expect(
        (await save({ ...base, currentPassword: "nope" })).body,
      ).toMatchObject({
        errors: { currentPassword: "Your current password is wrong." },
      });
      expect(
        (
          await save({
            ...base,
            newPassword: "short",
            confirmPassword: "short",
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await save({
            ...base,
            newPassword: "a-brand-new-password",
            confirmPassword: "a-different-password",
          })
        ).body.errors.confirmPassword,
      ).toBe("The passwords don't match.");

      const saved = await save({
        ...base,
        newPassword: "a-brand-new-password",
        confirmPassword: "a-brand-new-password",
      });
      expect(saved.location).toBe("/backoffice/profile?saved=1");
      const fresh = (saved.headers.get("set-cookie") ?? "").split(";")[0];
      // The password is stored hashed, never as typed.
      const row = await prisma.backofficeAdmin.findUniqueOrThrow({
        where: { id: 1 },
      });
      expect(row).toMatchObject({ name: "Owner", email: BACKOFFICE.email });
      expect(row.passwordHash).toMatch(/^scrypt:/);
      expect(row.passwordHash).not.toContain("a-brand-new-password");

      // The old session is signed out; the one that saved carries on.
      expect(
        (
          await run(
            routes.boPlans.loader,
            bo("/backoffice", undefined, first.cookie),
          )
        ).location,
      ).toBe("/backoffice/login");
      expect(
        (
          await run(
            routes.boPlans.loader,
            bo("/backoffice/plans", undefined, fresh),
          )
        ).status,
      ).toBe(200);
      // The old password no longer signs in; the new one does.
      expect((await signIn(BACKOFFICE.password)).status).toBe(401);
      expect((await signIn("a-brand-new-password")).status).toBe(302);
    } finally {
      // Back to the env values for the other steps and runs.
      await prisma.backofficeAdmin.deleteMany({});
    }
  });

  it("backoffice signs out and keeps every page behind sign-in", async () => {
    const { clearFailures } =
      await import("../services/backoffice-auth.server");
    clearFailures();
    const origin = "https://app.e2e.test";
    const bo = (
      path: string,
      form?: Record<string, string>,
      cookie = "",
      from = origin,
    ) =>
      new Request(`${origin}${path}`, {
        method: form ? "POST" : "GET",
        headers: {
          Origin: from,
          Host: "app.e2e.test",
          Cookie: cookie,
          ...(form
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
        },
        body: form ? new URLSearchParams(form) : undefined,
      });

    // Not signed in: the layout (every /backoffice page) sends to sign-in.
    expect(
      (await run(routes.boLayout.loader, bo("/backoffice"))).location,
    ).toBe("/backoffice/login");
    const login = await run(
      routes.boLogin.action,
      bo("/backoffice/login", {
        email: BACKOFFICE.email,
        password: BACKOFFICE.password,
      }),
    );
    expect(login.location).toBe("/backoffice");
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    const layout = await run(
      routes.boLayout.loader,
      bo("/backoffice", undefined, cookie),
    );
    expect(layout.body).toMatchObject({ email: BACKOFFICE.email });

    // Sign-out from another site is refused; a GET only goes back to the backoffice.
    const forged = await run(
      routes.boLogout.action,
      bo("/backoffice/logout", {}, cookie, "https://evil.example"),
    );
    expect(forged.status).toBe(403);
    expect(
      (await run(routes.boLogout.loader, bo("/backoffice/logout"))).location,
    ).toBe("/backoffice");
    const out = await run(
      routes.boLogout.action,
      bo("/backoffice/logout", {}, cookie),
    );
    expect(out.location).toBe("/backoffice/login");
    // The browser's cookie is cleared (expired), so the next page asks to sign in again.
    const cleared = out.headers.get("set-cookie") ?? "";
    expect(cleared).toMatch(/^__sparefit_bo=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
    expect(
      (
        await run(
          routes.boLayout.loader,
          bo("/backoffice", undefined, cleared.split(";")[0]),
        )
      ).location,
    ).toBe("/backoffice/login");
  });

  it("backoffice logs: errors, warnings and slow requests, per store, kept for the set time", async () => {
    const { clearFailures } =
      await import("../services/backoffice-auth.server");
    const logs = await import("../services/logs/logs.server");
    const { entryFromConsole } = await import("../services/logs/entry");
    const { slowEntry } = await import("../services/logs/slow.server");
    clearFailures();
    const origin = "https://app.e2e.test";
    const bo = (
      path: string,
      form?: Record<string, string>,
      cookie = "",
      from = origin,
    ) =>
      new Request(`${origin}${path}`, {
        method: form ? "POST" : "GET",
        headers: {
          Origin: from,
          Host: "app.e2e.test",
          Cookie: cookie,
          ...(form
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
        },
        body: form ? new URLSearchParams(form) : undefined,
      });
    expect(
      (await run(routes.boLogs.loader, bo("/backoffice/logs"))).location,
    ).toBe("/backoffice/login");
    const login = await run(
      routes.boLogin.action,
      bo("/backoffice/login", {
        email: BACKOFFICE.email,
        password: BACKOFFICE.password,
      }),
    );
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

    // What the app logs: an error for this shop (twice), a warning for the other, a slow request.
    const error = new Error("Throttled");
    logs.recordLog(
      entryFromConsole("error", [
        "storefront: e2e publish failed",
        { shop: SHOP, error },
      ]),
    );
    logs.recordLog(
      entryFromConsole("error", [
        "storefront: e2e publish failed",
        { shop: SHOP, error },
      ]),
    );
    logs.recordLog(
      entryFromConsole("warn", ["import: e2e odd column", { shop: OTHER }]),
    );
    logs.recordLog(
      slowEntry(
        new Request(`${APP_URL}/app/filter-data.data?shop=${SHOP}`),
        200,
        5200,
      )!,
    );
    await logs.flushLogs();

    const page = async (query: string) =>
      (
        await run(
          routes.boLogs.loader,
          bo(`/backoffice/logs?${query}`, undefined, cookie),
        )
      ).body;
    const shop = await page(`store=${SHOP}`);
    expect(shop.filters).toMatchObject({
      store: SHOP,
      level: "all",
      range: "24h",
    });
    expect(shop.logs.counts).toEqual({ error: 1, warn: 0, slow: 1 });
    const err = shop.logs.rows.find(
      (r: { level: string }) => r.level === "error",
    );
    expect(err).toMatchObject({
      source: "storefront",
      message: "storefront: e2e publish failed",
      shopDomain: SHOP,
      count: 2,
    });
    expect(err.detail).toContain("Error: Throttled");
    expect((await page(`store=${SHOP}&level=slow`)).logs.rows).toEqual([
      expect.objectContaining({
        message: "Slow request: GET /app/filter-data",
        durationMs: 5200,
      }),
    ]);
    expect((await page(`store=${OTHER}&level=warn`)).logs.total).toBe(1);
    expect((await page(`store=${OTHER}&level=error`)).logs.total).toBe(0);
    expect((await page(`store=${SHOP}&q=publish`)).logs.total).toBe(1);
    expect(shop.stores).toEqual(expect.arrayContaining([SHOP, OTHER]));
    // Odd values fall back.
    expect(
      (await page("store=evil.example.com&level=x&range=y")).filters,
    ).toMatchObject({
      store: "all",
      level: "all",
      range: "24h",
    });

    // Retention: saved with an Origin-checked post; 7, 14 or 30 days only.
    const saved = await prisma.backofficeSetting.findUnique({
      where: { key: "logRetentionDays" },
    });
    try {
      const forged = await run(
        routes.boLogs.action,
        bo(
          "/backoffice/logs",
          { intent: "retention", days: "30" },
          cookie,
          "https://evil.example",
        ),
      );
      expect(forged.status).toBe(403);
      const bad = await run(
        routes.boLogs.action,
        bo("/backoffice/logs", { intent: "retention", days: "3" }, cookie),
      );
      expect(bad.status).toBe(400);
      const ok = await run(
        routes.boLogs.action,
        bo("/backoffice/logs", { intent: "retention", days: "30" }, cookie),
      );
      expect(ok.body).toMatchObject({ ok: true, days: 30 });
      expect((await page("")).retention).toBe(30);
    } finally {
      if (saved) {
        await prisma.backofficeSetting.update({
          where: { key: "logRetentionDays" },
          data: { value: saved.value as number },
        });
      } else {
        await prisma.backofficeSetting.deleteMany({
          where: { key: "logRetentionDays" },
        });
      }
    }
    // Stays for the uninstall step: the purge deletes this shop's entries with the shop.
    expect(
      await prisma.appLog.count({ where: { shopDomain: SHOP } }),
    ).toBeGreaterThan(0);
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

  it("custom CSS on Settings is a plan feature and reaches the theme scoped to SpareFit", async () => {
    const { getPlan, updatePlan, clearPlansCache } =
      await import("../models/plan.server");
    const page = async () =>
      (await run(routes.settings.loader, adminRequest(SHOP, "/app/settings")))
        .body;
    const save = (css: string) =>
      run(
        routes.settings.action,
        adminRequest(SHOP, "/app/settings", {
          method: "POST",
          body: { form: { intent: "css", css } },
        }),
      );
    const published = () =>
      JSON.parse(shopify.shop(SHOP).appMetafields.get("sparefit.config")!);

    // Not in the seeded plans: locked, and a save is refused.
    // No plan has it yet: "" (no plan to name).
    expect((await page()).cssLocked).toBe("");
    expect((await save(".sp-fit { color: red }")).body).toEqual({
      ok: false,
      error: "Your plan doesn't include custom CSS.",
    });

    const original = (await getPlan("growth"))!;
    try {
      await updatePlan(
        "growth",
        { ...original, toggles: { ...original.toggles, customCss: true } },
        "e2e",
      );
      clearPlansCache();
      expect((await page()).cssLocked).toBeNull();

      const css =
        ".sp-sfw__go { text-transform: uppercase } @import url(https://x.test/a.css); body { display: none }";
      const saved = await save(css);
      expect(saved.body).toEqual({
        ok: true,
        dropped: ["@import"],
        theme: "published",
      });
      const theme = published().css as string;
      expect(theme).toContain("text-transform: uppercase");
      expect(theme).not.toContain("@import");
      // body only matches inside SpareFit's elements.
      expect(theme).toContain(":is(.sp-search-wrap,");
      expect(theme.split("\n").every((r) => !r.startsWith("body"))).toBe(true);
      expect((await page()).customCss).toBe(css);

      const tooLong = await save("a".repeat(5001));
      expect(tooLong.body.ok).toBe(false);

      // Clearing it removes the CSS from the theme.
      expect((await save("")).body.ok).toBe(true);
      expect(published()).not.toHaveProperty("css");
    } finally {
      await updatePlan("growth", { ...original }, "e2e-restore");
      clearPlansCache();
    }
  });

  it("scopes_update webhook stores the scopes the merchant granted", async () => {
    const offline = () =>
      prisma.session.findFirstOrThrow({
        where: { shop: SHOP, isOnline: false },
      });
    const before = (await offline()).scope;
    const send = (payload: unknown, secret?: string) =>
      run(
        routes.scopesWebhook.action,
        webhookRequest(
          "/webhooks/app/scopes_update",
          SHOP,
          "app/scopes_update",
          payload,
          secret ? { secret } : {},
        ),
      );
    expect((await send({ current: ["read_products"] }, "wrong")).status).toBe(
      401,
    );
    expect((await offline()).scope).toBe(before);
    // An odd payload is acknowledged (no retries) and changes nothing.
    expect((await send({ current: "read_products" })).status).toBe(200);
    expect((await offline()).scope).toBe(before);

    const granted = SCOPES.split(",");
    expect((await send({ previous: [], current: granted })).status).toBe(200);
    expect((await offline()).scope).toBe(granted.join(","));
  });

  it("the app URL outside the admin is a plain page; links with ?shop= go into the app", async () => {
    const plain = await run(routes.landing.loader, new Request(`${APP_URL}/`));
    // A public landing page: links only, no shop-domain field (App Store 2.3.1).
    expect(plain.status).toBe(200);
    expect(plain.body).toMatchObject({
      appStoreUrl: expect.stringContaining("apps.shopify.com"),
    });
    const withShop = await run(
      routes.landing.loader,
      new Request(`${APP_URL}/?shop=${SHOP}&host=abc`),
    );
    expect(withShop.status).toBe(302);
    expect(withShop.location).toBe(`/app?shop=${SHOP}&host=abc`);
  });

  it("uninstall stops the storefront, compliance webhooks answer, and the purge deletes the shop", async () => {
    const { purgeUninstalledShops } = await import("../services/purge.server");
    // Shopify cancels the charge as it uninstalls; that webhook can come first, when the shop's
    // session is already unusable. It must still get its 200 (no retry storm).
    await prisma.session.deleteMany({ where: { shop: SHOP } });
    const cancelled = await run(
      routes.subscriptionsWebhook.action,
      webhookRequest(
        "/webhooks/app/subscriptions_update",
        SHOP,
        "app_subscriptions/update",
        {
          app_subscription: {
            admin_graphql_api_id: "gid://shopify/AppSubscription/1",
            status: "CANCELLED",
          },
        },
      ),
    );
    expect(cancelled.status).toBe(200);
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
    expect(await prisma.appLog.count({ where: { shopDomain: SHOP } })).toBe(0);
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
