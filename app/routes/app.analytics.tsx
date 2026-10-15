// Analytics: how shoppers use the search on the storefront, from the daily counts the app proxy
// records (services/analytics/record.server.ts). Read-only.
// Spec: .claude/specs/analytics.md · Prototype: .claude/design/scripts/screens/analytics.js
import { useState } from "react";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { getSearchConfig } from "../models/search-config.server";
import { analyticsReport, fieldValues } from "../models/analytics.server";
import { fitSkus, shopSearch } from "../services/storefront/query.server";
import type { Picks } from "../services/storefront/picks";
import {
  changeLine,
  fmt,
  KEEP_DAYS,
  PERIODS,
  toPeriod,
  percent,
  selectionText,
  shortDay,
} from "../services/analytics/report";
import { PageHeader } from "../components/PageHeader";
import { SectionTitle } from "../components/SectionTitle";
import { EmptyState } from "../components/EmptyState";
import styles from "../styles/analytics.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const url = new URL(request.url);
  const days = toPeriod(url.searchParams.get("days"));
  const [config, search] = await Promise.all([
    getSearchConfig(shop.id),
    shopSearch(session.shop),
  ]);
  const fields = search?.fields ?? [];
  const asked = url.searchParams.get("field");
  const field = fields.find((f) => f.id === asked) ?? fields[0] ?? null;
  const [report, values] = await Promise.all([
    analyticsReport(shop.id, days),
    field ? fieldValues(shop.id, days, field.id) : [],
  ]);

  // Does each "found nothing" selection find products now (rows linked since)? null = unknown.
  const foundNow = await Promise.all(
    report.nothingFound.map(async (s) => {
      if (!search) return null;
      const picks: Picks = new Map();
      for (const f of search.fields) {
        const v = s.picks[f.id];
        if (v) picks.set(f.id, f.type === "year_range" ? Number(v) : v);
      }
      try {
        return (await fitSkus(search, picks, 0)).specific > 0;
      } catch {
        return null;
      }
    }),
  );

  const label = (picks: Record<string, string>) =>
    selectionText(fields, picks) ?? "Fields removed since";
  return {
    days,
    things: config?.thingsWord ?? "products",
    // Selection column header: the search field names, e.g. "Skin type › Concern".
    selectionHeader: fields.map((f) => f.label).join(" › ") || "Selection",
    fields: fields.map((f) => ({ id: f.id, label: f.label })),
    field: field?.id ?? null,
    report: {
      ...report,
      topSelections: report.topSelections.map((s) => ({
        ...s,
        label: label(s.picks),
      })),
      nothingFound: report.nothingFound.map((s, i) => ({
        ...s,
        label: label(s.picks),
        foundNow: foundNow[i],
      })),
    },
    values,
  };
};

type Data = ReturnType<typeof useLoaderData<typeof loader>>;

const valueOf = (e: Event) => (e.currentTarget as HTMLSelectElement).value;

export default function AnalyticsPage() {
  const data = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const r = data.report;
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { preventScrollReset: true });
  };

  return (
    <s-page inlineSize="base">
      <PageHeader title="Analytics">
        <div className="sp-an-period">
          <s-select
            label="Period"
            labelAccessibilityVisibility="exclusive"
            value={String(data.days)}
            onChange={(e) => setParam("days", valueOf(e))}
          >
            {PERIODS.map((p) => (
              <s-option key={p} value={String(p)}>
                Last {p} days
              </s-option>
            ))}
          </s-select>
        </div>
      </PageHeader>
      {!r.hasData ? (
        <s-section accessibilityLabel="Analytics">
          <EmptyState
            icon="chart-vertical"
            heading="No searches yet"
            actions={
              <s-button
                variant="primary"
                onClick={() => navigate("/app/storefront")}
              >
                Open storefront settings
              </s-button>
            }
          >
            When shoppers use the search on your store, you&apos;ll see here
            what they look for, which searches find nothing and how often your{" "}
            {data.things} fit what shoppers selected.
          </EmptyState>
        </s-section>
      ) : (
        <s-stack gap="base">
          <Overview data={data} />
          <s-section accessibilityLabel="Searches per day">
            <SectionTitle icon="chart-vertical" gap>
              Searches per day
            </SectionTitle>
            <DailyChart daily={r.daily} />
          </s-section>
          <NothingFound data={data} />
          <TopSearches data={data} />
          <FieldValues data={data} onField={(id) => setParam("field", id)} />
          <ProductPages data={data} />
          <s-text color="subdued">
            Days are in UTC and counts are kept for {KEEP_DAYS} days. SpareFit
            only counts searches; it records nothing about your shoppers.
          </s-text>
        </s-stack>
      )}
    </s-page>
  );
}

function Overview({ data }: { data: Data }) {
  const r = data.report;
  const found = percent(r.searches - r.noResults, r.searches);
  const checks = r.fits + r.noFit;
  const fitPct = percent(r.fits, checks);
  const cards = [
    {
      label: "Searches",
      value: fmt(r.searches),
      line: changeLine(r.searches, r.previousSearches, data.days),
    },
    {
      label: "Found products",
      value: found === null ? "—" : `${found}%`,
      badge: r.noResults > 0,
      line:
        r.noResults > 0
          ? `${fmt(r.noResults)} search${r.noResults === 1 ? "" : "es"} found nothing`
          : "Every search found products",
    },
    {
      label: "Different selections",
      value: fmt(r.selections),
      line: "Searched at least once",
    },
    {
      label: "Product page checks",
      value: fmt(checks),
      line:
        fitPct === null
          ? "No product page opened with a selection"
          : `${fitPct}% fit the shopper's selection`,
    },
  ];
  return (
    <div className="sp-an-cards">
      {cards.map((c) => (
        <div key={c.label} className="sp-an-card">
          <span className="sp-an-label">{c.label}</span>
          <span className="sp-an-value">
            <span className="sp-an-number">{c.value}</span>
            {c.badge && <s-badge tone="warning">Needs attention</s-badge>}
          </span>
          <span className="sp-an-line">{c.line}</span>
        </div>
      ))}
    </div>
  );
}

/** Columns per day; one series, so no legend. Hover or focus a day to read its numbers. */
function DailyChart({ daily }: { daily: Data["report"]["daily"] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d.searches));
  const total = daily.reduce((n, d) => n + d.searches, 0);
  const shown = active === null ? null : daily[active];
  const ticks = [0, Math.floor((daily.length - 1) / 2), daily.length - 1];
  return (
    <div className="sp-an-chart">
      <p className="sp-an-readout" aria-live="polite">
        {shown ? (
          <>
            <b>{shortDay(shown.day)}</b> · {fmt(shown.searches)} search
            {shown.searches === 1 ? "" : "es"}
            {shown.noResults > 0 && ` · ${fmt(shown.noResults)} found nothing`}
          </>
        ) : (
          <>
            <b>{fmt(total)}</b> searches · up to {fmt(max)} a day
          </>
        )}
      </p>
      <div className="sp-an-plot">
        <span className="sp-an-grid" style={{ bottom: "100%" }}>
          <i>{fmt(max)}</i>
        </span>
        <span className="sp-an-grid" style={{ bottom: "50%" }}>
          <i>{fmt(Math.round(max / 2))}</i>
        </span>
        <span className="sp-an-grid is-base" style={{ bottom: 0 }}>
          <i>0</i>
        </span>
        <div
          className="sp-an-bars"
          onMouseLeave={() => setActive(null)}
          role="group"
          aria-label="Searches per day"
        >
          {daily.map((d, i) => (
            <button
              key={d.day}
              type="button"
              className={`sp-an-bar${active === i ? " is-active" : ""}`}
              aria-label={`${shortDay(d.day)} · ${fmt(d.searches)} search${d.searches === 1 ? "" : "es"} · ${fmt(d.noResults)} found nothing`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <span
                style={{
                  height: d.searches ? `${(d.searches / max) * 100}%` : 0,
                }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="sp-an-axis" aria-hidden="true">
        {ticks.map((t, i) => (
          <span key={i}>{daily[t] ? shortDay(daily[t].day) : ""}</span>
        ))}
      </div>
    </div>
  );
}

function NothingFound({ data }: { data: Data }) {
  const navigate = useNavigate();
  const rows = data.report.nothingFound;
  return (
    <s-section accessibilityLabel="Searches that found nothing">
      <s-stack gap="base">
        <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
          <SectionTitle icon="alert-triangle">
            Searches that found nothing
          </SectionTitle>
          {rows.length > 0 && (
            <s-button onClick={() => navigate("/app/product-mapping")}>
              Open product mapping
            </s-button>
          )}
        </s-grid>
        {rows.length === 0 ? (
          <s-text color="subdued">
            Every search in this period found {data.things}.
          </s-text>
        ) : (
          <>
            <s-text color="subdued">
              Shoppers searched for these, but no {data.things} were shown: the
              SKUs in their filter rows aren&apos;t linked to an active product.
              Link them in Product mapping.
            </s-text>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">
                  {data.selectionHeader}
                </s-table-header>
                <s-table-header format="numeric">Found nothing</s-table-header>
                <s-table-header>Last time</s-table-header>
                <s-table-header>Now</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {rows.map((s, i) => (
                  <s-table-row key={i}>
                    <s-table-cell>{s.label}</s-table-cell>
                    <s-table-cell>{fmt(s.noResults)}</s-table-cell>
                    <s-table-cell>
                      {s.lastNoResult ? shortDay(s.lastNoResult) : "—"}
                    </s-table-cell>
                    <s-table-cell>
                      {s.foundNow === null ? (
                        "—"
                      ) : s.foundNow ? (
                        <s-badge tone="success">Finds products</s-badge>
                      ) : (
                        <s-badge tone="warning">Still nothing</s-badge>
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </>
        )}
      </s-stack>
    </s-section>
  );
}

function TopSearches({ data }: { data: Data }) {
  const rows = data.report.topSelections;
  return (
    <s-section accessibilityLabel="Top searches">
      <s-stack gap="base">
        <SectionTitle icon="search">Top searches</SectionTitle>
        <s-text color="subdued">
          What shoppers searched most. Keep their filter rows complete and their{" "}
          {data.things} in stock.
        </s-text>
        {rows.length === 0 ? (
          <s-text color="subdued">No searches in this period.</s-text>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">
                {data.selectionHeader}
              </s-table-header>
              <s-table-header format="numeric">Searches</s-table-header>
              <s-table-header format="numeric">Found nothing</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((s, i) => (
                <s-table-row key={i}>
                  <s-table-cell>{s.label}</s-table-cell>
                  <s-table-cell>{fmt(s.searches)}</s-table-cell>
                  <s-table-cell>
                    {s.noResults ? fmt(s.noResults) : "—"}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-stack>
    </s-section>
  );
}

function FieldValues({
  data,
  onField,
}: {
  data: Data;
  onField: (id: string) => void;
}) {
  if (!data.field) return null;
  const label = data.fields.find((f) => f.id === data.field)?.label ?? "";
  const max = Math.max(1, ...data.values.map((v) => v.searches));
  return (
    <s-section accessibilityLabel={`Most searched ${label}`}>
      <s-stack gap="base">
        <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
          <SectionTitle icon="list-bulleted">
            Most searched by field
          </SectionTitle>
          <div className="sp-an-field">
            <s-select
              label="Search field"
              labelAccessibilityVisibility="exclusive"
              value={data.field}
              onChange={(e) => onField(valueOf(e))}
            >
              {data.fields.map((f) => (
                <s-option key={f.id} value={f.id}>
                  {f.label}
                </s-option>
              ))}
            </s-select>
          </div>
        </s-grid>
        {data.values.length === 0 ? (
          <s-text color="subdued">
            No searches used {label} in this period.
          </s-text>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{label}</s-table-header>
              <s-table-header format="numeric">Searches</s-table-header>
              <s-table-header>Share</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.values.map((v) => (
                <s-table-row key={v.value}>
                  <s-table-cell>{v.value}</s-table-cell>
                  <s-table-cell>{fmt(v.searches)}</s-table-cell>
                  <s-table-cell>
                    <div className="sp-an-share" aria-hidden="true">
                      <span
                        style={{
                          width: `${Math.max(2, (v.searches / max) * 100)}%`,
                        }}
                      />
                    </div>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-stack>
    </s-section>
  );
}

function ProductPages({ data }: { data: Data }) {
  const rows = data.report.products;
  return (
    <s-section accessibilityLabel="Product pages">
      <s-stack gap="base">
        <SectionTitle icon="product">Product pages</SectionTitle>
        <s-text color="subdued">
          How often shoppers opened a product page with a selection, and whether
          the product fits it. Many &quot;doesn&apos;t fit&quot; checks can mean
          the product is missing filter rows for what your shoppers select.
        </s-text>
        {rows.length === 0 ? (
          <s-text color="subdued">
            No product page was opened with a selection in this period.
          </s-text>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header format="numeric">Checks</s-table-header>
              <s-table-header format="numeric">Fits</s-table-header>
              <s-table-header format="numeric">Doesn&apos;t fit</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((p) => (
                <s-table-row key={p.productId}>
                  <s-table-cell>{p.title ?? "Removed product"}</s-table-cell>
                  <s-table-cell>{fmt(p.fits + p.noFit)}</s-table-cell>
                  <s-table-cell>{fmt(p.fits)}</s-table-cell>
                  <s-table-cell>{p.noFit ? fmt(p.noFit) : "—"}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-stack>
    </s-section>
  );
}
