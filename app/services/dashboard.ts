// Dashboard content (specs/dashboard.md; texts from .claude/design/scripts/screens/dashboard.js):
// the five setup guide steps with their real state, and the four overview cards. Pure.
import { effectivePlan, trialDaysLeft, type ShopPlan } from "./billing";

export interface DashboardFacts {
  fields: { label: string; type: "list" | "years" }[];
  noun: string;
  things: string;
  rowCount: number;
  skus: number;
  unlinkedSkus: number;
  withoutData: number;
  /** Distinct values of the first three list fields (label → count). */
  coverage: { label: string; count: number }[];
  /** Live theme: app embed on; null when the theme couldn't be read. */
  embedOn: boolean | null;
  /** Of the 4 storefront features; null when the theme couldn't be read. */
  blocksAdded: number | null;
  plan: ShopPlan;
  /** A plan is picked (billing connected and a subscription exists). */
  planChosen: boolean;
  trialEndsAt: Date | null;
}

export type GuideIcon = "fields" | "upload" | "link" | "store" | "plans";

export interface GuideStep {
  label: string;
  title: string;
  description: string;
  cta: string;
  to: string;
  icon: GuideIcon;
  minutes: number;
  done: boolean;
}

const s = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function guideSteps(f: DashboardFacts, now = new Date()): GuideStep[] {
  const un = f.unlinkedSkus;
  const plan = effectivePlan(f.plan);
  const days = trialDaysLeft(f.trialEndsAt, now);
  return [
    {
      label: "Search setup",
      title: "Set up your search",
      description: `Shoppers search by ${f.fields.map((x) => x.label).join(" › ")}. Rename, reorder or add fields any time, and the changes show on your store right away.`,
      cta: "Open search setup",
      to: "/app/search-setup",
      icon: "fields",
      minutes: 1,
      done: true,
    },
    {
      label: "Import data",
      title: "Import your filter data",
      description: f.rowCount
        ? `${f.rowCount.toLocaleString("en-US")} rows are in. Import your file again any time: new rows are added, changed rows are updated and nothing else is lost.`
        : "Upload a CSV with your SKUs and the items they fit. Any column layout works, and you check the columns before importing.",
      cta: "Import data",
      to: "/app/search-setup?import=1",
      icon: "upload",
      minutes: 2,
      done: f.rowCount > 0,
    },
    {
      label: "Link products",
      title: "Link SKUs to products",
      description: un
        ? `${un.toLocaleString("en-US")} SKU${s(un, " has", "s have")} no product yet. Shoppers won't see ${s(un, "it", "them")} until ${s(un, "it is", "they are")} linked to a product in your store.`
        : `Every SKU is linked to a product, so shoppers can find all of your ${f.things} in the search.`,
      cta: "Review links",
      to: "/app/product-mapping",
      icon: "link",
      minutes: 2,
      done: f.rowCount > 0 && un === 0,
    },
    {
      label: "Go live",
      title: "Add the search to your store",
      description:
        "Add the search block to your home page and the fits badge to product pages in the theme editor. It only takes a few clicks.",
      cta: "Open storefront settings",
      to: "/app/storefront",
      icon: "store",
      minutes: 3,
      done: f.embedOn === true,
    },
    {
      label: "Plan",
      title: "Choose a plan",
      description: f.planChosen
        ? days
          ? `You are on the ${plan.name} trial, ${days} day${s(days, "", "s")} left. Change or cancel your plan any time.`
          : `You are on the ${plan.name} plan. Change it any time as your catalog grows.`
        : "Pick the plan that suits your catalog. Starter is free; paid plans start with a 14-day free trial.",
      cta: "Compare plans",
      to: "/app/plans",
      icon: "plans",
      minutes: 1,
      done: f.planChosen,
    },
  ];
}

/** "make" → "makes", "model" → "models", "series" stays (prototype's plural()). */
export function plural(label: string, n: number) {
  const l = label.toLowerCase();
  if (n === 1 || /(series|species)$/.test(l)) return l;
  if (/(s|x|ch|sh)$/.test(l)) return l + "es";
  if (/[^aeiou]y$/.test(l)) return l.slice(0, -1) + "ies";
  return l + "s";
}

export interface OverviewCard {
  label: string;
  value: string;
  badge: { tone: "critical" | "warning"; text: string } | null;
  line: string;
  to: string;
}

export function overviewCards(f: DashboardFacts): OverviewCard[] {
  const pct = f.skus
    ? Math.round(((f.skus - f.unlinkedSkus) / f.skus) * 100)
    : 0;
  const n = (x: number) => x.toLocaleString("en-US");
  return [
    {
      label: "Search on your store",
      value: f.embedOn === null ? "—" : f.embedOn ? "Live" : "Off",
      badge: f.embedOn === false ? { tone: "critical", text: "Hidden" } : null,
      line:
        f.blocksAdded === null
          ? "Couldn't check your theme"
          : `${f.blocksAdded} of 4 blocks added`,
      to: "/app/storefront",
    },
    {
      label: "Filter rows",
      value: n(f.rowCount),
      badge: null,
      line: !f.rowCount
        ? "No data yet"
        : !f.coverage.length
          ? `${n(f.skus)} ${f.skus === 1 ? "SKU" : "SKUs"}`
          : f.coverage
              .map((c) => `${n(c.count)} ${plural(c.label, c.count)}`)
              .join(" · "),
      to: "/app/filter-data",
    },
    {
      label: "Unlinked SKUs",
      value: n(f.unlinkedSkus),
      badge: f.unlinkedSkus ? { tone: "warning", text: "Needs linking" } : null,
      line: `${pct}% of SKUs linked`,
      to: "/app/product-mapping",
    },
    {
      label: "Products without filter data",
      value: n(f.withoutData),
      badge: null,
      line: "Not shown in any search",
      to: "/app/product-mapping",
    },
  ];
}
