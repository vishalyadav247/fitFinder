// Seeded plan values for tests against the shared local database (see seedPlansForRun).
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The dev database's own plans while a run has replaced them. Written before seeding, removed
 * after restoring: a run that was killed (Ctrl-C, crash) leaves it, and the next run restores it
 * first, so the super admin's plans are never lost.
 */
const SNAPSHOT = path.join(tmpdir(), "sparefit-test-plans-snapshot.json");
/**
 * Tests that touch Postgres expect the seeded plans (migration 20261013120000_plans_backoffice): Starter free
 * with 5,000 rows and 50 products, Growth $29 with a 14-day trial, and so on. The plans table is
 * shared with the dev database, where the super admin edits them, so the run sets the seeded values
 * and returns a function that puts the merchant-facing rows back exactly as they were.
 */
export async function seedPlansForRun(): Promise<() => Promise<void>> {
  const { default: prisma } = await import("../db.server");
  const { clearPlansCache } = await import("../models/plan.server");
  type Row = Awaited<ReturnType<typeof prisma.plan.findMany>>[number];
  const restore = async (rows: Row[]) => {
    await prisma.$transaction([
      // Rows the run created (a key the dev database didn't have).
      prisma.plan.deleteMany({
        where: { key: { notIn: rows.map((r) => r.key) } },
      }),
      ...rows.map(({ key, limits, toggles, ...data }) =>
        prisma.plan.upsert({
          where: { key },
          create: {
            key,
            ...data,
            limits: limits ?? {},
            toggles: toggles ?? {},
          },
          update: { ...data, limits: limits ?? {}, toggles: toggles ?? {} },
        }),
      ),
    ]);
    clearPlansCache();
  };
  // An earlier run that was killed: its snapshot holds the real plans.
  if (existsSync(SNAPSHOT)) {
    const rows = JSON.parse(readFileSync(SNAPSHOT, "utf8"), (k, v) =>
      (k === "updatedAt" || k === "createdAt") && typeof v === "string"
        ? new Date(v)
        : v,
    ) as Row[];
    await restore(rows);
    rmSync(SNAPSHOT, { force: true });
  }
  const saved = await prisma.plan.findMany();
  writeFileSync(SNAPSHOT, JSON.stringify(saved));
  const seeded = [
    {
      key: "starter",
      position: 1,
      name: "Starter",
      description: "For trying SpareFit on a small catalog.",
      isFree: true,
      priceMonthly: 0,
      priceYearly: null,
      trialDays: 0,
      visible: true,
      limits: { rows: 5000, products: 50, searchFields: null, backups: 5 },
      toggles: {
        fitsBadge: true,
        fitmentTable: false,
        mySelection: false,
        universalProducts: false,
        importBackups: true,
        customCss: false,
      },
      bullets: ["Search section", "CSV import with column mapping"],
    },
    {
      key: "growth",
      position: 2,
      name: "Growth",
      description: "For growing catalogs.",
      isFree: false,
      priceMonthly: 29,
      priceYearly: 290,
      trialDays: 14,
      visible: true,
      limits: { rows: 500000, products: 5000, searchFields: null, backups: 5 },
      toggles: {
        fitsBadge: true,
        fitmentTable: true,
        mySelection: true,
        universalProducts: true,
        importBackups: true,
        customCss: false,
      },
      bullets: ["Everything in Starter"],
    },
    {
      key: "pro",
      position: 3,
      name: "Pro",
      description: "For large catalogs.",
      isFree: false,
      priceMonthly: 99,
      priceYearly: 990,
      trialDays: 14,
      visible: true,
      limits: { rows: null, products: null, searchFields: null, backups: 5 },
      toggles: {
        fitsBadge: true,
        fitmentTable: true,
        mySelection: true,
        universalProducts: true,
        importBackups: true,
        customCss: false,
      },
      bullets: ["Everything in Growth"],
    },
    {
      key: "business",
      position: 4,
      name: "Business",
      description: "For the largest catalogs.",
      isFree: false,
      priceMonthly: 199,
      priceYearly: 1990,
      trialDays: 14,
      visible: false,
      limits: { rows: null, products: null, searchFields: null, backups: 20 },
      toggles: {
        fitsBadge: true,
        fitmentTable: true,
        mySelection: true,
        universalProducts: true,
        importBackups: true,
        customCss: false,
      },
      bullets: ["Everything in Pro"],
    },
  ];
  await prisma.$transaction(
    seeded.map(({ key, ...data }) =>
      prisma.plan.upsert({
        where: { key },
        create: { key, ...data, updatedBy: "e2e" },
        update: { ...data, updatedBy: "e2e" },
      }),
    ),
  );
  clearPlansCache();
  return async () => {
    await restore(saved);
    rmSync(SNAPSHOT, { force: true });
  };
}
