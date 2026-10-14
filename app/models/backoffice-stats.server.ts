// Numbers for the backoffice Overview (specs/backoffice.md): stores, revenue, trials, setup
// progress, imports and recent activity across all shops. The super admin's own app-wide view,
// so these queries are deliberately not scoped to one shop; they only read counts, plans and shop
// domains (no shopper or merchant customer data).
import prisma from "../db.server";
import { getPlans } from "./plan.server";

const DAY = 86_400_000;

export interface OverviewStats {
  stores: {
    installed: number;
    new30: number;
    uninstalled30: number;
    /** Installs per UTC day, oldest first (last 30 days, including today). */
    installsByDay: { day: string; count: number }[];
  };
  revenue: {
    /** Monthly recurring revenue from active charges past their trial (yearly / 12). */
    mrr: number;
    /** What charges still in their trial will add once it ends. */
    inTrial: number;
    payingStores: number;
    trialStores: number;
  };
  plans: { key: string; name: string; count: number; isFree: boolean }[];
  noPlan: number;
  trialsEnding: { domain: string; plan: string; endsAt: string }[];
  setup: {
    installed: number;
    onboarded: number;
    withData: number;
    linked: number;
  };
  imports7: { completed: number; failed: number; rows: number };
  activity: {
    at: string;
    kind: "install" | "uninstall" | "subscribed" | "cancelled";
    domain: string;
    detail: string;
  }[];
}

export async function overviewStats(now = new Date()): Promise<OverviewStats> {
  const since30 = new Date(now.getTime() - 30 * DAY);
  const since7 = new Date(now.getTime() - 7 * DAY);
  const in7 = new Date(now.getTime() + 7 * DAY);
  const live = { uninstalledAt: null };

  const [
    installed,
    new30,
    uninstalled30,
    byDay,
    byPlan,
    plans,
    charges,
    trialsEnding,
    setupRow,
    importRows,
    recentInstalls,
    recentUninstalls,
    recentCharges,
  ] = await Promise.all([
    prisma.shop.count({ where: live }),
    prisma.shop.count({ where: { ...live, installedAt: { gte: since30 } } }),
    prisma.shop.count({ where: { uninstalledAt: { gte: since30 } } }),
    prisma.$queryRaw<{ day: Date; count: number }[]>`
      SELECT d::date AS day, count(s.id)::int AS count
      FROM generate_series(${since30}::date + 1, ${now}::date, interval '1 day') d
      LEFT JOIN shops s ON s.installed_at::date = d::date
      GROUP BY d ORDER BY d`,
    prisma.shop.groupBy({ by: ["plan"], where: live, _count: { _all: true } }),
    getPlans(),
    prisma.appSubscription.findMany({
      where: { status: "ACTIVE", endedAt: null, shop: live },
      select: {
        price: true,
        interval: true,
        trialDays: true,
        activatedAt: true,
      },
    }),
    prisma.shop.findMany({
      where: { ...live, trialEndsAt: { gt: now, lte: in7 } },
      orderBy: { trialEndsAt: "asc" },
      take: 8,
      select: { domain: true, plan: true, trialEndsAt: true },
    }),
    prisma.$queryRaw<
      { onboarded: number; with_data: number; linked: number }[]
    >`
      SELECT
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM search_configs c WHERE c.shop_id = s.id))::int AS onboarded,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM fitment_rows f WHERE f.shop_id = s.id))::int AS with_data,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM product_links l WHERE l.shop_id = s.id))::int AS linked
      FROM shops s WHERE s.uninstalled_at IS NULL`,
    prisma.importJob.groupBy({
      by: ["status"],
      where: {
        finishedAt: { gte: since7 },
        status: { in: ["completed", "failed"] },
      },
      _count: { _all: true },
      _sum: { added: true, imported: true },
    }),
    prisma.shop.findMany({
      where: { installedAt: { gte: since30 } },
      orderBy: { installedAt: "desc" },
      take: 8,
      select: { domain: true, installedAt: true },
    }),
    prisma.shop.findMany({
      where: { uninstalledAt: { gte: since30 } },
      orderBy: { uninstalledAt: "desc" },
      take: 8,
      select: { domain: true, uninstalledAt: true },
    }),
    prisma.appSubscription.findMany({
      where: {
        OR: [{ activatedAt: { gte: since30 } }, { endedAt: { gte: since30 } }],
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: {
        planKey: true,
        activatedAt: true,
        endedAt: true,
        shop: { select: { domain: true } },
      },
    }),
  ]);

  const planName = (key: string) =>
    plans.find((p) => p.key === key)?.name ?? key;
  const counts = Object.fromEntries(byPlan.map((r) => [r.plan, r._count._all]));

  let mrr = 0;
  let inTrial = 0;
  let paying = 0;
  let trialing = 0;
  for (const c of charges) {
    const monthly =
      c.interval === "ANNUAL" ? Number(c.price) / 12 : Number(c.price);
    const trialOver =
      !c.activatedAt ||
      c.activatedAt.getTime() + c.trialDays * DAY <= now.getTime();
    if (trialOver) {
      mrr += monthly;
      paying++;
    } else {
      inTrial += monthly;
      trialing++;
    }
  }

  const activity: OverviewStats["activity"] = [
    ...recentInstalls.map((s) => ({
      at: s.installedAt.toISOString(),
      kind: "install" as const,
      domain: s.domain,
      detail: "Installed SpareFit",
    })),
    ...recentUninstalls.map((s) => ({
      at: s.uninstalledAt!.toISOString(),
      kind: "uninstall" as const,
      domain: s.domain,
      detail: "Uninstalled SpareFit",
    })),
    ...recentCharges.flatMap((c) => [
      ...(c.activatedAt && c.activatedAt >= since30
        ? [
            {
              at: c.activatedAt.toISOString(),
              kind: "subscribed" as const,
              domain: c.shop.domain,
              detail: `Started ${planName(c.planKey)}`,
            },
          ]
        : []),
      ...(c.endedAt && c.endedAt >= since30
        ? [
            {
              at: c.endedAt.toISOString(),
              kind: "cancelled" as const,
              domain: c.shop.domain,
              detail: `Left ${planName(c.planKey)}`,
            },
          ]
        : []),
    ]),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10);

  const imports = (status: string) =>
    importRows.find((r) => r.status === status);

  return {
    stores: {
      installed,
      new30,
      uninstalled30,
      installsByDay: byDay.map((r) => ({
        day: new Date(r.day).toISOString().slice(0, 10),
        count: r.count,
      })),
    },
    revenue: {
      mrr: Math.round(mrr * 100) / 100,
      inTrial: Math.round(inTrial * 100) / 100,
      payingStores: paying,
      trialStores: trialing,
    },
    plans: plans.map((p) => ({
      key: p.key,
      name: p.name,
      count: counts[p.key] ?? 0,
      isFree: p.isFree,
    })),
    noPlan: counts.none ?? 0,
    trialsEnding: trialsEnding.map((s) => ({
      domain: s.domain,
      plan: planName(s.plan),
      endsAt: s.trialEndsAt!.toISOString(),
    })),
    setup: {
      installed,
      onboarded: setupRow[0]?.onboarded ?? 0,
      withData: setupRow[0]?.with_data ?? 0,
      linked: setupRow[0]?.linked ?? 0,
    },
    imports7: {
      completed: imports("completed")?._count._all ?? 0,
      failed: imports("failed")?._count._all ?? 0,
      rows:
        (imports("completed")?._sum.added ?? 0) +
        (imports("completed")?._sum.imported ?? 0),
    },
    activity,
  };
}
