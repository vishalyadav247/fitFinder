// Dashboard facts (specs/dashboard.md › Data): counts from the shop's data, the live theme's
// FitFinder status (theme files, as on the Storefront page) and the plan. Every query is scoped
// by shop; a theme that can't be read leaves its parts unknown instead of failing the page.
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { rowCounts } from "../models/fitment-row.server";
import { productsWithoutDataCount } from "../models/product-link.server";
import type { AdminGraphql } from "./linking/catalog.server";
import { loadStorefrontConfig } from "./storefront/sync.server";
import { listThemes, readThemeStatus } from "./storefront/themes.server";
import type { ThemeStatusView } from "./storefront/themes";
import type { DashboardFacts } from "./dashboard";
import type { PlanState } from "./billing.server";

const COVERAGE_FIELDS = 3;

/** Distinct values of the first three list fields (one scan). */
export async function coverage(
  shopId: string,
  fields: { id: string; label: string; type: "list" | "years" }[],
) {
  const lists = fields
    .filter((f) => f.type === "list")
    .slice(0, COVERAGE_FIELDS);
  if (!lists.length) return [];
  // A read with a time limit: on a very large shop the overview line can be left out instead
  // of failing the Dashboard.
  const [row] = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '8s'");
      // One hashed GROUP BY per field: 4× faster than count(DISTINCT …) (which sorts) on 727k
      // rows (M10).
      return tx.$queryRaw<Record<string, number>[]>`
    SELECT ${Prisma.join(
      lists.map(
        (f, i) =>
          Prisma.sql`(SELECT count(*) FROM (SELECT 1 FROM fitment_rows f
            WHERE f.shop_id = ${shopId} AND f."values"->>${f.id} IS NOT NULL
            GROUP BY f."values"->>${f.id}) g)::int
            AS ${Prisma.raw(`c${i}`)}`,
      ),
    )}`;
    },
    { timeout: 10_000, maxWait: 10_000 },
  );
  return lists.map((f, i) => ({ label: f.label, count: row[`c${i}`] ?? 0 }));
}

/** FitFinder's 4 storefront features in the live theme (Storefront page rules). */
export function featuresAdded(
  status: ThemeStatusView,
  s: { tablePlace: "block" | "tabs"; garage: boolean },
) {
  return [
    status.blocks.search !== undefined,
    status.blocks.badge !== undefined,
    s.tablePlace === "tabs"
      ? status.tableCodeFound
      : status.blocks.table !== undefined,
    status.embedOn && s.garage,
  ].filter(Boolean).length;
}

async function liveTheme(gql: AdminGraphql, shopId: string) {
  try {
    const live = (await listThemes(gql)).find((t) => t.role === "MAIN");
    return live ? await readThemeStatus(gql, shopId, live.id) : null;
  } catch (error) {
    console.error("dashboard: live theme read failed", { shopId, error });
    return null;
  }
}

export async function dashboardFacts(
  gql: AdminGraphql,
  shopId: string,
  plan: PlanState,
): Promise<DashboardFacts | null> {
  const config = await loadStorefrontConfig(shopId);
  if (!config) return null;
  const [counts, withoutData, cov, theme] = await Promise.all([
    rowCounts(shopId),
    productsWithoutDataCount(shopId),
    coverage(shopId, config.fields).catch((error) => {
      console.error("dashboard: coverage read failed", { shopId, error });
      return [];
    }),
    liveTheme(gql, shopId),
  ]);
  return {
    fields: config.fields.map((f) => ({ label: f.label, type: f.type })),
    noun: config.noun,
    things: config.things,
    rowCount: counts.total,
    skus: counts.skus,
    unlinkedSkus: counts.unlinkedSkus,
    withoutData,
    coverage: cov,
    embedOn: theme ? theme.embedOn : null,
    blocksAdded: theme ? featuresAdded(theme, config.s) : null,
    plan: plan.connected ? plan.plan : "none",
    planChosen: plan.connected && plan.plan !== "none",
    trialEndsAt: plan.trialEndsAt,
  };
}
