// Backoffice › Overview (/backoffice): how SpareFit is doing across all stores at a glance —
// stores, revenue, trials, setup progress, imports and recent activity (specs/backoffice.md).
// Read-only; numbers come from overviewStats (models/backoffice-stats.server.ts).
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { requireAdmin } from "../services/backoffice-auth.server";
import { overviewStats } from "../models/backoffice-stats.server";
import { formatPrice } from "../services/billing";
import { Icon, type IconName } from "../components/backoffice/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  return { stats: await overviewStats(), at: new Date().toISOString() };
};

const n = (v: number) => v.toLocaleString("en-US");
const plural = (v: number, one: string, many: string) =>
  `${n(v)} ${v === 1 ? one : many}`;
const pct = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 100) : 0;
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** "3 h ago", "2 d ago" (from the loader's clock, so server and browser agree). */
function ago(iso: string, now: string) {
  const s = Math.max(0, (Date.parse(now) - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

function Kpi({
  icon,
  label,
  value,
  note,
}: {
  icon: IconName;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="bo-glass bo-kpi">
      <span className="bo-kpi-label">
        <span className="bo-chip-icon">
          <Icon name={icon} size={15} />
        </span>
        {label}
      </span>
      <b className="bo-kpi-value">{value}</b>
      <span className="bo-help">{note}</span>
    </div>
  );
}

function CardTitle({ icon, children }: { icon: IconName; children: string }) {
  return (
    <h2 className="bo-section-title">
      <span className="bo-chip-icon">
        <Icon name={icon} size={16} />
      </span>
      {children}
    </h2>
  );
}

/** Installs per day: one bar per day on a shared baseline; hover shows the day and count. */
function InstallsChart({ days }: { days: { day: string; count: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((a, d) => a + d.count, 0);
  return (
    <figure
      className="bo-chart"
      aria-label={`Installs per day, last 30 days: ${total} in total`}
    >
      <div className="bo-chart-plot">
        <span className="bo-chart-max">{n(max)}</span>
        {days.map((d) => (
          <span
            key={d.day}
            className="bo-bar"
            data-tip={`${shortDate(d.day)} · ${plural(d.count, "install", "installs")}`}
            aria-hidden="true"
          >
            <span
              style={{
                height: `${d.count ? Math.max(4, (d.count / max) * 100) : 0}%`,
              }}
            />
          </span>
        ))}
      </div>
      <figcaption className="bo-chart-axis">
        <span>{days[0] ? shortDate(days[0].day) : ""}</span>
        <span>{days.length ? shortDate(days[days.length - 1].day) : ""}</span>
      </figcaption>
      {/* The same numbers as a table, for screen readers. */}
      <table className="bo-sr">
        <caption>Installs per day, last 30 days</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <th scope="row">{shortDate(d.day)}</th>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A labelled horizontal bar: name left, value right, bar under (value always visible). */
function Meter({
  label,
  value,
  max,
  suffix,
  muted,
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  muted?: boolean;
}) {
  return (
    <div className="bo-meter">
      <div className="bo-meter-row">
        <span>{label}</span>
        <b>
          {n(value)}
          {suffix && <small>{suffix}</small>}
        </b>
      </div>
      <div className={`bo-meter-track${muted ? " is-muted" : ""}`}>
        <span
          style={{
            width: `${max ? Math.max(value ? 2 : 0, (value / max) * 100) : 0}%`,
          }}
        />
      </div>
    </div>
  );
}

const ACTIVITY: Record<
  "install" | "uninstall" | "subscribed" | "cancelled",
  { icon: IconName; tone: string }
> = {
  install: { icon: "store", tone: "is-good" },
  uninstall: { icon: "logout", tone: "is-bad" },
  subscribed: { icon: "money", tone: "is-accent" },
  cancelled: { icon: "alert", tone: "is-warn" },
};

export default function Overview() {
  const { stats, at } = useLoaderData<typeof loader>();
  const s = stats;
  const planMax = Math.max(1, s.noPlan, ...s.plans.map((p) => p.count));
  const funnel = [
    { label: "Installed", value: s.setup.installed },
    { label: "Search set up (store type chosen)", value: s.setup.onboarded },
    { label: "Filter data added", value: s.setup.withData },
    { label: "Products linked", value: s.setup.linked },
  ];

  return (
    <>
      <div className="bo-head">
        <div>
          <h1 className="bo-title">Overview</h1>
          <p className="bo-sub">How SpareFit is doing across all stores.</p>
        </div>
        <span className="bo-help">
          <Icon name="clock" size={14} /> Updated {ago(at, at)}
        </span>
      </div>

      <div className="bo-kpis">
        <Kpi
          icon="store"
          label="Installed stores"
          value={n(s.stores.installed)}
          note={`+${n(s.stores.new30)} in the last 30 days`}
        />
        <Kpi
          icon="money"
          label="Monthly revenue"
          value={formatPrice(s.revenue.mrr)}
          note={`From ${plural(s.revenue.payingStores, "paying store", "paying stores")} (yearly ÷ 12)`}
        />
        <Kpi
          icon="clock"
          label="In free trial"
          value={n(s.revenue.trialStores)}
          note={
            s.revenue.inTrial
              ? `${formatPrice(s.revenue.inTrial)} / month once trials end`
              : "No stores in a trial"
          }
        />
        <Kpi
          icon="logout"
          label="Uninstalls"
          value={n(s.stores.uninstalled30)}
          note="In the last 30 days"
        />
      </div>

      <div className="bo-grid-2">
        <section className="bo-glass bo-card bo-card--span">
          <CardTitle icon="trend">Installs, last 30 days</CardTitle>
          {s.stores.installsByDay.some((d) => d.count) ? (
            <InstallsChart days={s.stores.installsByDay} />
          ) : (
            <p className="bo-empty">No installs in the last 30 days.</p>
          )}
        </section>

        <section className="bo-glass bo-card">
          <CardTitle icon="plans">Stores per plan</CardTitle>
          <div className="bo-meters">
            {s.plans.map((p) => (
              <Meter
                key={p.key}
                label={`${p.name}${p.isFree ? " (free)" : ""}`}
                value={p.count}
                max={planMax}
              />
            ))}
            <Meter
              label="No plan picked yet"
              value={s.noPlan}
              max={planMax}
              muted
            />
          </div>
          <Link to="/backoffice/plans" className="bo-link">
            Manage plans →
          </Link>
        </section>

        <section className="bo-glass bo-card">
          <CardTitle icon="check">Setup progress</CardTitle>
          <div className="bo-meters">
            {funnel.map((f) => (
              <Meter
                key={f.label}
                label={f.label}
                value={f.value}
                max={s.setup.installed}
                suffix={
                  f.label === "Installed"
                    ? undefined
                    : ` · ${pct(f.value, s.setup.installed)}%`
                }
              />
            ))}
          </div>
          <p className="bo-help">
            Of the stores that have SpareFit installed now.
          </p>
        </section>

        <section className="bo-glass bo-card">
          <CardTitle icon="upload">Imports, last 7 days</CardTitle>
          <div className="bo-mini-stats">
            <div>
              <b>{n(s.imports7.completed)}</b>
              <span>Finished</span>
            </div>
            <div>
              <b className={s.imports7.failed ? "is-bad" : undefined}>
                {n(s.imports7.failed)}
              </b>
              <span>Failed</span>
            </div>
            <div>
              <b>{n(s.imports7.rows)}</b>
              <span>Rows added</span>
            </div>
          </div>
        </section>

        <section className="bo-glass bo-card">
          <CardTitle icon="clock">Trials ending in 7 days</CardTitle>
          {s.trialsEnding.length ? (
            <ul className="bo-list">
              {s.trialsEnding.map((t) => (
                <li key={t.domain}>
                  <span className="bo-list-main">
                    <b>{t.domain}</b>
                    <small>{t.plan}</small>
                  </span>
                  <span className="bo-badge bo-badge--info">
                    Ends {shortDate(t.endsAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="bo-empty">No trials end in the next 7 days.</p>
          )}
        </section>

        <section className="bo-glass bo-card bo-card--span">
          <CardTitle icon="list">Recent activity</CardTitle>
          {s.activity.length ? (
            <ul className="bo-timeline">
              {s.activity.map((a, i) => (
                <li key={`${a.at}-${i}`}>
                  <span className={`bo-dot ${ACTIVITY[a.kind].tone}`}>
                    <Icon name={ACTIVITY[a.kind].icon} size={14} />
                  </span>
                  <span className="bo-list-main">
                    <b>{a.domain}</b>
                    <small>{a.detail}</small>
                  </span>
                  <span
                    className="bo-help"
                    title={new Date(a.at).toUTCString()}
                  >
                    {ago(a.at, at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="bo-empty">Nothing happened in the last 30 days.</p>
          )}
        </section>
      </div>
    </>
  );
}
