// Numbers for the backoffice Overview (specs/backoffice.md): stores, revenue, trials, recent
// activity and the Stores table across all shops. The super admin's own app-wide view,
// so these queries are deliberately not scoped to one shop; they only read counts, plans and shop
// domains (no shopper or merchant customer data).
import prisma from "../db.server";
import { getPlans } from "./plan.server";
import type {
  STORE_SORTS,
  STORE_STATUSES,
} from "../services/backoffice-shared";

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
  activity: {
    at: string;
    kind: "install" | "uninstall" | "subscribed" | "cancelled";
    domain: string;
    detail: string;
  }[];
}

export async function overviewStats(now = new Date()): Promise<OverviewStats> {
  const since30 = new Date(now.getTime() - 30 * DAY);
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
    activity,
  };
}

// ------------------------------------------------------------------ stores list

export interface StoreListQuery {
  /** Part of the shop domain. */
  q: string;
  status: (typeof STORE_STATUSES)[number];
  /** A plan key, "none" (no plan picked) or "all". */
  plan: string;
  sort: (typeof STORE_SORTS)[number];
  page: number;
  pageSize: number;
}

export interface StoreRow {
  domain: string;
  /** Store type key (automotive, phones…); null before onboarding. */
  storeType: string | null;
  plan: string;
  planName: string | null;
  trialEndsAt: string | null;
  installedAt: string;
  uninstalledAt: string | null;
  lastActiveAt: string;
  /** Search field labels in order: the dropdowns shoppers pick from. */
  fields: string[];
  rows: number;
  linkedSkus: number;
  searches30: number;
}

export interface StoreList {
  stores: StoreRow[];
  /** Stores matching the filters (all pages). */
  total: number;
  page: number;
  pageSize: number;
}

/**
 * One page of stores for the Overview's Stores table. The per-store counts (filter rows, linked
 * SKUs, searches) are read only for the stores on the page, so a big catalog elsewhere doesn't
 * slow the list down.
 */
export async function storeList(
  query: StoreListQuery,
  now = new Date(),
): Promise<StoreList> {
  const where = {
    ...(query.status === "installed" ? { uninstalledAt: null } : {}),
    ...(query.status === "uninstalled" ? { uninstalledAt: { not: null } } : {}),
    ...(query.plan !== "all" ? { plan: query.plan } : {}),
    ...(query.q
      ? { domain: { contains: query.q, mode: "insensitive" as const } }
      : {}),
  };
  const orderBy =
    query.sort === "domain"
      ? [{ domain: "asc" as const }]
      : query.sort === "active"
        ? [{ lastAuthAt: "desc" as const }, { domain: "asc" as const }]
        : [{ installedAt: "desc" as const }, { domain: "asc" as const }];

  const [total, shops, plans] = await Promise.all([
    prisma.shop.count({ where }),
    prisma.shop.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        domain: true,
        plan: true,
        trialEndsAt: true,
        installedAt: true,
        uninstalledAt: true,
        lastAuthAt: true,
        searchConfig: { select: { storeType: true } },
        searchFields: { select: { label: true }, orderBy: { position: "asc" } },
      },
    }),
    getPlans(),
  ]);

  const ids = shops.map((s) => s.id);
  const since30 = new Date(now.getTime() - 30 * DAY);
  const counts = ids.length
    ? await prisma.$queryRaw<
        { id: string; rows: number; links: number; searches: number }[]
      >`
        SELECT s.id,
          (SELECT count(*) FROM fitment_rows f WHERE f.shop_id = s.id)::int AS rows,
          (SELECT count(*) FROM product_links l WHERE l.shop_id = s.id)::int AS links,
          (SELECT coalesce(sum(t.searches), 0) FROM search_stats t
            WHERE t.shop_id = s.id AND t.day >= ${since30}::date)::int AS searches
        FROM shops s WHERE s.id = ANY(${ids})`
    : [];
  const byId = new Map(counts.map((c) => [c.id, c]));

  return {
    stores: shops.map((s) => {
      const c = byId.get(s.id);
      return {
        domain: s.domain,
        storeType: s.searchConfig?.storeType ?? null,
        plan: s.plan,
        planName: plans.find((p) => p.key === s.plan)?.name ?? null,
        trialEndsAt:
          s.trialEndsAt && s.trialEndsAt > now
            ? s.trialEndsAt.toISOString()
            : null,
        installedAt: s.installedAt.toISOString(),
        uninstalledAt: s.uninstalledAt?.toISOString() ?? null,
        lastActiveAt: s.lastAuthAt.toISOString(),
        fields: s.searchFields.map((f) => f.label),
        rows: c?.rows ?? 0,
        linkedSkus: c?.links ?? 0,
        searches30: c?.searches ?? 0,
      };
    }),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}
