// Backoffice › Logs (/backoffice/logs): the app's errors, warnings and slow requests, to
// understand performance and debug (specs/backoffice.md). Entries come from console.error /
// console.warn in the web server and the job worker, unhandled route errors and the request
// timer (services/logs/). Filters live in the URL; the retention (7, 14 or 30 days) is saved here.
import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  Form,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigation,
  useSubmit,
} from "react-router";
import { z } from "zod";
import { checkOrigin, requireAdmin } from "../services/backoffice-auth.server";
import {
  getLogRetentionDays,
  listLogs,
  logStores,
  setLogRetentionDays,
  type LogRow,
} from "../services/logs/logs.server";
import {
  LOG_LEVELS,
  LOG_RANGES,
  LOG_RETENTION_DAYS,
} from "../services/backoffice-shared";
import { tablePageSize } from "../components/table-paging";
import { TableFooter } from "../components/backoffice/table";
import {
  Icon,
  Toast,
  toast,
  type ToastMessage,
} from "../components/backoffice/ui";
import { ago, n } from "../components/backoffice/format";

const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** The filters, from the URL (anything odd falls back to the default). */
const LogParams = z.object({
  level: z.enum(LOG_LEVELS).catch("all"),
  store: z
    .string()
    .max(255)
    .refine((v) => v === "all" || v === "none" || SHOP.test(v))
    .catch("all"),
  range: z.enum(LOG_RANGES).catch("24h"),
  q: z.string().trim().max(100).catch(""),
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  const params = new URL(request.url).searchParams;
  const parsed = LogParams.parse({
    level: params.get("level") ?? undefined,
    store: params.get("store") ?? undefined,
    range: params.get("range") ?? undefined,
    q: params.get("q") ?? undefined,
    page: params.get("page") ?? undefined,
  });
  const query = { ...parsed, pageSize: tablePageSize(params.get("size")) };
  const [first, stores, retention] = await Promise.all([
    listLogs(query),
    logStores(query.range),
    getLogRetentionDays(),
  ]);
  // A page past the end (entries deleted since, or a typed URL): show the last page instead.
  const last = Math.max(1, Math.ceil(first.total / query.pageSize));
  const page = Math.min(query.page, last);
  const logs = page === query.page ? first : await listLogs({ ...query, page });
  return {
    logs,
    filters: { ...query, page },
    // The filtered store stays in the list even when it has no entries in the range.
    stores:
      query.store !== "all" &&
      query.store !== "none" &&
      !stores.includes(query.store)
        ? [query.store, ...stores]
        : stores,
    retention,
    at: new Date().toISOString(),
  };
};

const Retention = z.object({
  intent: z.literal("retention"),
  days: z.coerce
    .number()
    .refine((d) => (LOG_RETENTION_DAYS as readonly number[]).includes(d)),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireAdmin(request);
  checkOrigin(request);
  const parsed = Retention.safeParse(
    Object.fromEntries(await request.formData()),
  );
  if (!parsed.success) {
    return data({ error: "Choose 7, 14 or 30 days." }, { status: 400 });
  }
  const days = parsed.data.days as (typeof LOG_RETENTION_DAYS)[number];
  const deleted = await setLogRetentionDays(days);
  return { ok: true as const, days, deleted };
};

const LEVEL: Record<
  LogRow["level"],
  { label: string; badge: string; icon: "alert" | "info" | "clock" }
> = {
  error: { label: "Error", badge: "bo-badge--critical", icon: "alert" },
  warn: { label: "Warning", badge: "bo-badge--warning", icon: "info" },
  slow: { label: "Slow request", badge: "bo-badge--info", icon: "clock" },
};

const LEVEL_TABS: { value: (typeof LOG_LEVELS)[number]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "error", label: "Errors" },
  { value: "warn", label: "Warnings" },
  { value: "slow", label: "Slow requests" },
];

const RANGE_LABELS: Record<(typeof LOG_RANGES)[number], string> = {
  "1h": "Last hour",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  all: "Everything kept",
};

const RETENTION_LABELS: Record<number, string> = {
  7: "7 days",
  14: "14 days",
  30: "1 month",
};

const fullTime = (iso: string) => new Date(iso).toUTCString();

export default function Logs() {
  const { logs, filters, stores, retention, at } =
    useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const location = useLocation();
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const [open, setOpen] = useState<string | null>(null);
  const loading =
    navigation.state === "loading" &&
    navigation.location.pathname === "/backoffice/logs";

  /** Applies the filters; a changed filter starts again at page 1. */
  const apply = (page = 1, set: Record<string, string> = {}) => {
    if (!formRef.current) return;
    const form = new FormData(formRef.current);
    for (const [k, v] of Object.entries(set)) form.set(k, v);
    form.set("page", String(page));
    submit(form, { method: "get", replace: true, preventScrollReset: true });
  };

  // Retention: a longer period saves at once; a shorter one deletes entries, so it asks first.
  const retentionFetcher = useFetcher<typeof action>();
  const [days, setDays] = useState(retention);
  const [confirmDays, setConfirmDays] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState<ToastMessage | null>(null);
  useEffect(() => setDays(retention), [retention]);
  useEffect(() => {
    const d = retentionFetcher.data;
    if (!d) return;
    if ("error" in d) {
      setDays(retention);
      setMessage(toast(d.error, true));
    } else {
      setMessage(
        toast(
          `Logs are kept for ${RETENTION_LABELS[d.days]}` +
            (d.deleted ? ` · ${n(d.deleted)} older entries deleted` : ""),
        ),
      );
    }
    // Only a new answer shows a toast, not a reload of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retentionFetcher.data]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirmDays !== null && !dialog.open) dialog.showModal();
    if (confirmDays === null && dialog.open) dialog.close();
  }, [confirmDays]);
  const savingRetention = retentionFetcher.state !== "idle";
  const saveRetention = (value: number) => {
    setDays(value);
    setConfirmDays(null);
    retentionFetcher.submit(
      { intent: "retention", days: String(value) },
      { method: "post" },
    );
  };

  const counts = logs.counts;
  const countOf = (level: (typeof LOG_LEVELS)[number]) =>
    level === "all" ? counts.error + counts.warn + counts.slow : counts[level];
  const filtered =
    filters.level !== "all" || filters.store !== "all" || filters.q !== "";

  return (
    <>
      <div className="bo-head">
        <div>
          <h1 className="bo-title">Logs</h1>
          <p className="bo-sub">
            Errors, warnings and slow requests from the app and its background
            jobs.
          </p>
        </div>
        <div className="bo-retention">
          <label>
            <span className="bo-help">Keep logs for</span>
            <select
              className="bo-input bo-input--sm"
              name="days"
              value={String(confirmDays ?? days)}
              disabled={savingRetention}
              onChange={(e) => {
                const value = Number(e.currentTarget.value);
                if (value < days) setConfirmDays(value);
                else if (value !== days) saveRetention(value);
              }}
            >
              {LOG_RETENTION_DAYS.map((d) => (
                <option key={d} value={d}>
                  {RETENTION_LABELS[d]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <dialog
        ref={dialogRef}
        className="bo-dialog bo-glass"
        aria-labelledby="retention-title"
        onClose={() => setConfirmDays(null)}
      >
        {confirmDays !== null && (
          <>
            <h2 id="retention-title" className="bo-section-title">
              Keep logs for {RETENTION_LABELS[confirmDays]}?
            </h2>
            <p className="bo-sub">
              Entries last seen more than {RETENTION_LABELS[confirmDays]} ago
              will be deleted now. This can&apos;t be undone.
            </p>
            <div className="bo-dialog-actions">
              <button
                type="button"
                className="bo-btn bo-btn--ghost"
                onClick={() => setConfirmDays(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="bo-btn bo-btn--danger"
                onClick={() => saveRetention(confirmDays)}
              >
                Delete older entries
              </button>
            </div>
          </>
        )}
      </dialog>

      <section
        className={`bo-glass bo-card bo-list-card${loading ? " is-loading" : ""}`}
        aria-busy={loading}
      >
        <div className="bo-tabs" role="group" aria-label="Level">
          {LEVEL_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`bo-tab${filters.level === t.value ? " is-active" : ""}`}
              aria-pressed={filters.level === t.value}
              onClick={() => apply(1, { level: t.value })}
            >
              {t.label}
              <span className="bo-tab-count">{n(countOf(t.value))}</span>
            </button>
          ))}
        </div>

        <Form
          // Remount on a new URL (e.g. the Logs nav item), so the fields show the URL's filters.
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
          <input type="hidden" name="level" value={filters.level} />
          <input type="hidden" name="size" value={filters.pageSize} />
          <label className="bo-filter bo-filter--search">
            <span className="bo-sr">Search logs</span>
            <input
              className="bo-input"
              type="search"
              name="q"
              placeholder="Search messages, sources and paths"
              defaultValue={filters.q}
              maxLength={100}
              onChange={() => {
                clearTimeout(timer.current);
                timer.current = setTimeout(() => apply(), 350);
              }}
            />
          </label>
          <label className="bo-filter bo-filter--wide">
            <span className="bo-sr">Store</span>
            <select
              className="bo-input"
              name="store"
              defaultValue={filters.store}
              onChange={() => apply()}
            >
              <option value="all">All stores</option>
              <option value="none">App-wide (no store)</option>
              {stores.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="bo-filter">
            <span className="bo-sr">Time</span>
            <select
              className="bo-input"
              name="range"
              defaultValue={filters.range}
              onChange={() => apply()}
            >
              {LOG_RANGES.map((r) => (
                <option key={r} value={r}>
                  {RANGE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
        </Form>

        {logs.rows.length === 0 ? (
          <p className="bo-empty">
            {filtered
              ? "No log entries match these filters."
              : filters.range === "all"
                ? "No errors, warnings or slow requests. All quiet."
                : `Nothing logged in the ${RANGE_LABELS[filters.range].toLowerCase()}. All quiet.`}
          </p>
        ) : (
          <div className="bo-table-wrap">
            <table className="bo-table bo-logs">
              <thead>
                <tr>
                  <th scope="col">Level</th>
                  <th scope="col">Message</th>
                  <th scope="col">Store</th>
                  <th scope="col" className="is-num">
                    Times
                  </th>
                  <th scope="col">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {logs.rows.map((r) => {
                  const isOpen = open === r.id;
                  return (
                    <LogRows
                      key={r.id}
                      row={r}
                      isOpen={isOpen}
                      onToggle={() => setOpen(isOpen ? null : r.id)}
                      level={LEVEL[r.level]}
                      at={at}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {logs.total > 0 && (
          <TableFooter
            total={logs.total}
            page={filters.page}
            pageSize={filters.pageSize}
            busy={loading}
            onPage={(p) => apply(p)}
            onPageSize={(size) => apply(1, { size: String(size) })}
          />
        )}
      </section>
      <Toast message={message} onDone={() => setMessage(null)} />
    </>
  );
}

function LogRows({
  row: r,
  isOpen,
  onToggle,
  level,
  at,
}: {
  row: LogRow;
  isOpen: boolean;
  onToggle: () => void;
  level: (typeof LEVEL)[LogRow["level"]];
  at: string;
}) {
  const detailId = `log-${r.id}`;
  return (
    <>
      <tr className={`bo-log-row${isOpen ? " is-open" : ""}`}>
        <td>
          <span className={`bo-badge ${level.badge}`}>
            <Icon name={level.icon} size={12} />
            {level.label}
          </span>
        </td>
        <td className="bo-log-main">
          <button
            type="button"
            className="bo-log-toggle"
            aria-expanded={isOpen}
            aria-controls={isOpen ? detailId : undefined}
            onClick={onToggle}
          >
            <span className="bo-log-message">{r.message}</span>
            <small>
              {r.source}
              {r.durationMs !== null &&
                ` · ${(r.durationMs / 1000).toFixed(1)} s`}
            </small>
          </button>
        </td>
        <td>{r.shopDomain ?? <span className="bo-faint">App-wide</span>}</td>
        <td className="is-num">{n(r.count)}</td>
        <td title={fullTime(r.lastAt)}>{ago(r.lastAt, at)}</td>
      </tr>
      {isOpen && (
        <tr className="bo-log-detail" id={detailId}>
          <td colSpan={5}>
            <dl className="bo-log-facts">
              <div>
                <dt>First seen</dt>
                <dd>{fullTime(r.firstAt)}</dd>
              </div>
              <div>
                <dt>Last seen</dt>
                <dd>{fullTime(r.lastAt)}</dd>
              </div>
              <div>
                <dt>Times</dt>
                <dd>{n(r.count)}</dd>
              </div>
              {r.path && (
                <div>
                  <dt>Request</dt>
                  <dd>{r.path}</dd>
                </div>
              )}
              {r.durationMs !== null && (
                <div>
                  <dt>Slowest</dt>
                  <dd>{(r.durationMs / 1000).toFixed(1)} s</dd>
                </div>
              )}
            </dl>
            {r.detail ? (
              <pre className="bo-log-pre">{r.detail}</pre>
            ) : (
              <p className="bo-faint">No more details were logged.</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
