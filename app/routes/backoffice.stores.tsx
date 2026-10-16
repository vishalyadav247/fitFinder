// Backoffice › Stores (/backoffice/stores): every store that installed SpareFit, with its plan,
// search fields and how much it uses them (specs/backoffice.md). Read-only; one page of stores
// from storeList (models/backoffice-stats.server.ts). Filters live in the URL.
import { useEffect, useRef } from "react";
import type { LoaderFunctionArgs } from "react-router";
import {
  Form,
  Link,
  useLoaderData,
  useLocation,
  useNavigation,
  useSubmit,
} from "react-router";
import { z } from "zod";
import { requireAdmin } from "../services/backoffice-auth.server";
import { storeList, type StoreList } from "../models/backoffice-stats.server";
import { STORE_SORTS, STORE_STATUSES } from "../services/backoffice-shared";
import { getPlans } from "../models/plan.server";
import { STORE_TYPES } from "../services/store-types";
import { tablePageSize } from "../components/table-paging";
import { TableFooter } from "../components/backoffice/table";
import { ago, n, shortDate } from "../components/backoffice/format";

/** The table's filters, from the URL (anything odd falls back to the default). */
const StoresParams = z.object({
  q: z.string().trim().max(100).catch(""),
  status: z.enum(STORE_STATUSES).catch("installed"),
  plan: z.string().max(40).catch("all"),
  sort: z.enum(STORE_SORTS).catch("newest"),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  const params = new URL(request.url).searchParams;
  const parsed = StoresParams.parse({
    q: params.get("q") ?? undefined,
    status: params.get("status") ?? undefined,
    plan: params.get("plan") ?? undefined,
    sort: params.get("sort") ?? undefined,
    page: params.get("page") ?? undefined,
  });
  const plans = await getPlans();
  const query = {
    ...parsed,
    plan:
      parsed.plan === "none" || plans.some((p) => p.key === parsed.plan)
        ? parsed.plan
        : "all",
    pageSize: tablePageSize(params.get("size")),
  };
  const first = await storeList(query);
  // A page past the end (stores gone since, or a typed URL): show the last page instead.
  const last = Math.max(1, Math.ceil(first.total / query.pageSize));
  const stores =
    query.page > last ? await storeList({ ...query, page: last }) : first;
  return {
    stores,
    filters: { ...query, page: stores.page },
    planOptions: plans.map((p) => ({ key: p.key, name: p.name })),
    at: new Date().toISOString(),
  };
};

export default function Stores() {
  const { stores, filters, planOptions, at } = useLoaderData<typeof loader>();
  return (
    <>
      <div className="bo-head">
        <div>
          <h1 className="bo-title">Stores</h1>
          <p className="bo-sub">
            Every store with SpareFit: its plan, search fields and how much it
            uses them.
          </p>
        </div>
      </div>
      <StoresCard
        list={stores}
        filters={filters}
        planOptions={planOptions}
        at={at}
      />
    </>
  );
}

type Filters = ReturnType<typeof useLoaderData<typeof loader>>["filters"];

const STATUS_LABELS: Record<(typeof STORE_STATUSES)[number], string> = {
  installed: "Installed",
  uninstalled: "Uninstalled",
  all: "All stores",
};
const SORT_LABELS: Record<(typeof STORE_SORTS)[number], string> = {
  newest: "Newest installs",
  active: "Last active",
  domain: "Domain A–Z",
};

/**
 * Every store with its plan, search fields and how much it uses SpareFit. Filters live in the
 * URL (a GET form), so a filtered view can be bookmarked or shared with the team.
 */
function StoresCard({
  list,
  filters,
  planOptions,
  at,
}: {
  list: StoreList;
  filters: Filters;
  planOptions: { key: string; name: string }[];
  at: string;
}) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const location = useLocation();
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const loading =
    navigation.state === "loading" &&
    navigation.location.pathname === "/backoffice/stores";

  /** Applies the filters; a changed filter starts again at page 1. */
  const apply = (page = 1) => {
    if (!formRef.current) return;
    const data = new FormData(formRef.current);
    data.set("page", String(page));
    submit(data, { method: "get", replace: true, preventScrollReset: true });
  };
  const onSearch = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(), 350);
  };

  const { total, page, pageSize } = list;
  const filtered =
    filters.q !== "" ||
    filters.status !== "installed" ||
    filters.plan !== "all";

  return (
    <section
      className={`bo-glass bo-card bo-list-card${loading ? " is-loading" : ""}`}
      aria-busy={loading}
    >
      <Form
        // Remount on a new URL (e.g. the Stores nav item), so the fields show the URL's filters.
        key={location.search}
        ref={formRef}
        method="get"
        className="bo-filters"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <label className="bo-filter bo-filter--search">
          <span className="bo-sr">Search stores</span>
          <input
            className="bo-input"
            type="search"
            name="q"
            placeholder="Search by domain"
            defaultValue={filters.q}
            maxLength={100}
            onChange={onSearch}
          />
        </label>
        <label className="bo-filter">
          <span className="bo-sr">Status</span>
          <select
            className="bo-input"
            name="status"
            defaultValue={filters.status}
            onChange={() => apply()}
          >
            {STORE_STATUSES.map((v) => (
              <option key={v} value={v}>
                {STATUS_LABELS[v]}
              </option>
            ))}
          </select>
        </label>
        <label className="bo-filter">
          <span className="bo-sr">Plan</span>
          <select
            className="bo-input"
            name="plan"
            defaultValue={filters.plan}
            onChange={() => apply()}
          >
            <option value="all">All plans</option>
            {planOptions.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
            <option value="none">No plan picked yet</option>
          </select>
        </label>
        <label className="bo-filter">
          <span className="bo-sr">Sort by</span>
          <select
            className="bo-input"
            name="sort"
            defaultValue={filters.sort}
            onChange={() => apply()}
          >
            {STORE_SORTS.map((v) => (
              <option key={v} value={v}>
                {SORT_LABELS[v]}
              </option>
            ))}
          </select>
        </label>
        <input type="hidden" name="size" value={pageSize} />
      </Form>

      {list.stores.length === 0 ? (
        <p className="bo-empty">
          {filtered
            ? "No stores match these filters."
            : "No stores have SpareFit installed yet."}
        </p>
      ) : (
        <div className="bo-table-wrap">
          <table className="bo-table">
            <thead>
              <tr>
                <th scope="col">Store</th>
                <th scope="col">Plan</th>
                <th scope="col">Search fields</th>
                <th scope="col" className="is-num">
                  Filter rows
                </th>
                <th scope="col" className="is-num">
                  Linked SKUs
                </th>
                <th scope="col" className="is-num">
                  Searches (30 d)
                </th>
                <th scope="col">Installed</th>
                <th scope="col">Last active</th>
              </tr>
            </thead>
            <tbody>
              {list.stores.map((st) => (
                <tr
                  key={st.domain}
                  className={st.uninstalledAt ? "is-gone" : undefined}
                >
                  <td>
                    <span className="bo-list-main">
                      <a
                        href={`https://${st.domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bo-store-link"
                      >
                        {st.domain}
                        <span className="bo-sr"> (opens in a new tab)</span>
                      </a>
                      <small>
                        {st.storeType
                          ? (STORE_TYPES[
                              st.storeType as keyof typeof STORE_TYPES
                            ]?.label ?? st.storeType)
                          : "Not set up yet"}
                        {" · "}
                        <Link
                          to={`/backoffice/logs?store=${encodeURIComponent(st.domain)}&range=7d`}
                          className="bo-inline-link"
                          aria-label={`Logs for ${st.domain}`}
                        >
                          Logs
                        </Link>
                      </small>
                    </span>
                  </td>
                  <td>
                    <span className="bo-cell-badges">
                      {st.uninstalledAt ? (
                        <span
                          className="bo-badge bo-badge--critical"
                          title={new Date(st.uninstalledAt).toUTCString()}
                        >
                          Uninstalled {shortDate(st.uninstalledAt)}
                        </span>
                      ) : st.planName ? (
                        <span className="bo-badge bo-badge--accent">
                          {st.planName}
                        </span>
                      ) : (
                        <span className="bo-badge">No plan</span>
                      )}
                      {st.trialEndsAt && !st.uninstalledAt && (
                        <span className="bo-badge bo-badge--info">
                          Trial · ends {shortDate(st.trialEndsAt)}
                        </span>
                      )}
                    </span>
                  </td>
                  <td>
                    {st.fields.length ? (
                      <span
                        className="bo-fields-cell"
                        title={st.fields.join(" › ")}
                      >
                        {st.fields.join(" › ")}
                      </span>
                    ) : (
                      <span className="bo-faint">—</span>
                    )}
                  </td>
                  <td className="is-num">{n(st.rows)}</td>
                  <td className="is-num">{n(st.linkedSkus)}</td>
                  <td className="is-num">{n(st.searches30)}</td>
                  <td title={new Date(st.installedAt).toUTCString()}>
                    {shortDate(st.installedAt)}
                  </td>
                  <td title={new Date(st.lastActiveAt).toUTCString()}>
                    {ago(st.lastActiveAt, at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <TableFooter
          total={total}
          page={page}
          pageSize={pageSize}
          busy={loading}
          onPage={apply}
          onPageSize={(size) => {
            const input = formRef.current?.elements.namedItem("size");
            if (input instanceof HTMLInputElement) input.value = String(size);
            apply();
          }}
        />
      )}
    </section>
  );
}
