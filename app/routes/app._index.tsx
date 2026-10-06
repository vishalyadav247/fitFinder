// Dashboard: banner, setup guide and overview cards, from the shop's real state.
// Spec: .claude/specs/dashboard.md · Prototype: .claude/design/scripts/screens/dashboard.js
import { Suspense, useEffect, useState } from "react";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Await, useLoaderData, useNavigate } from "react-router";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { getSearchConfig } from "../models/search-config.server";
import prisma from "../db.server";
import { shopPlan, usage } from "../services/billing.server";
import {
  effectivePlan,
  formatLimit,
  LIMIT_LABEL,
  overLimits,
} from "../services/billing";
import { dashboardFacts } from "../services/dashboard.server";
import { guideSteps, overviewCards } from "../services/dashboard";
import { STORE_TYPES } from "../services/store-types";
import { Icon } from "../components/Icon";
import styles from "../styles/dashboard.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin, redirect } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const config = await getSearchConfig(shop.id);
  // The layout redirects too, but child loaders run in parallel with it.
  if (!config) throw redirect("/app/onboarding");
  const fields = await prisma.searchField.findMany({
    where: { shopId: shop.id },
    orderBy: { position: "asc" },
    select: { label: true },
  });

  // The setup guide and overview need the plan (Partner API), the live theme (Admin API) and
  // counts over every filter row: streamed in after the banner shows (seconds on a 700k-row shop).
  // Back from Shopify's plan page (welcome link): read the new plan right away.
  const force = new URL(request.url).searchParams.has("plan_handle");
  const details = (async () => {
    const plan = await shopPlan(admin.graphql, shop.id, { force });
    const facts = await dashboardFacts(admin.graphql, shop.id, plan);
    if (!facts) throw new Error("FitFinder isn't set up for this store.");
    const used = await usage(shop.id, undefined, { rows: facts.rowCount });
    const current = effectivePlan(facts.plan);
    return {
      facts,
      over: overLimits(used, current.limits).map(
        (k) => `${formatLimit(current.limits[k])} ${LIMIT_LABEL[k]}`,
      ),
      planName: current.name,
    };
  })();
  // Logged here; the page shows the error element.
  details.catch((error) =>
    console.error("dashboard: details failed", {
      shop: session.shop,
      // A thrown Response (e.g. an expired session) logs its status, not the object.
      error: error instanceof Response ? `HTTP ${error.status}` : error,
    }),
  );

  return {
    shop: session.shop,
    storeType: config.storeType,
    heading: config.heading,
    noun: config.noun,
    things: config.thingsWord,
    fieldNames: fields.map((f) => f.label),
    details,
  };
};

type Details = Awaited<Awaited<ReturnType<typeof loader>>["details"]>;

/** "a", "a and b", "a, b and c". */
const listText = (items: string[]) =>
  items.length > 1
    ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
    : (items[0] ?? "");

const STATUS = (done: boolean, now: boolean) =>
  done ? "Done" : now ? "In progress" : "To do";

export default function DashboardPage() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const preset = STORE_TYPES[data.storeType];
  const fieldNames = data.fieldNames;
  const rowsLine = (
    <Suspense fallback="Filter rows">
      <Await resolve={data.details} errorElement="Filter rows">
        {(d) => `${d.facts.rowCount.toLocaleString("en-US")} filter rows`}
      </Await>
    </Suspense>
  );

  return (
    <s-page heading="Dashboard" inlineSize="base">
      <section className="ff-hero">
        <div>
          <span className="ff-eyebrow">
            <Icon name={preset.icon} size={14} /> {preset.label}
          </span>
          <h1>{data.heading}</h1>
          <p className="ff-lead">
            Shoppers pick their {data.noun} by{" "}
            {fieldNames.map((l) => l.toLowerCase()).join(", ")} and only see{" "}
            {data.things} that fit. Fewer wrong orders, fewer returns.
          </p>
          <div className="ff-hero-actions">
            <button
              type="button"
              className="ff-hbtn main"
              onClick={() => navigate("/app/storefront")}
            >
              Add search to your store
            </button>
            <button
              type="button"
              className="ff-hbtn alt"
              onClick={() => navigate("/app/search-setup")}
            >
              Open search setup
            </button>
          </div>
        </div>
        <div className="ff-how">
          <p className="ff-how-title">How it works</p>
          <ol className="ff-how-list">
            {(
              [
                [
                  preset.icon,
                  `Shopper picks their ${data.noun}`,
                  fieldNames.join(" › "),
                ],
                ["rows", "FitFinder matches", rowsLine],
                [
                  "check",
                  `Only ${data.things} that fit`,
                  "Fewer wrong orders and returns",
                ],
              ] as const
            ).map(([icon, title, sub], i) => (
              <li key={title} className={`ff-how-step s${i + 1}`}>
                <span className="ff-how-ico">
                  <Icon name={icon} size={16} stroke={2.2} />
                </span>
                <div>
                  <b>{title}</b>
                  <span>{sub}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <Suspense fallback={<DetailsPlaceholder />}>
        <Await
          resolve={data.details}
          errorElement={
            <s-banner tone="critical" heading="The overview couldn't be loaded">
              Reload the page to try again.
            </s-banner>
          }
        >
          {(details) => <DashboardDetails shop={data.shop} details={details} />}
        </Await>
      </Suspense>
    </s-page>
  );
}

/** Same height as the guide and overview, so nothing jumps when they arrive. */
function DetailsPlaceholder() {
  return (
    <div className="ff-details-loading">
      <s-section accessibilityLabel="Setup guide">
        <s-stack alignItems="center" gap="small">
          <s-spinner size="base" accessibilityLabel="Loading your setup" />
        </s-stack>
      </s-section>
    </div>
  );
}

function DashboardDetails({
  shop,
  details,
}: {
  shop: string;
  details: Details;
}) {
  const navigate = useNavigate();
  const data = details;
  const facts = details.facts;
  const trialEndsAt = facts.trialEndsAt ? new Date(facts.trialEndsAt) : null;
  const steps = guideSteps({ ...facts, trialEndsAt });
  const cards = overviewCards({ ...facts, trialEndsAt });
  const doneCount = steps.filter((s) => s.done).length;
  const firstOpen = steps.findIndex((s) => !s.done);
  const [cur, setCur] = useState(Math.max(0, firstOpen));

  // The guide's collapsed state is kept per shop in this browser.
  const closedKey = `fitfinder:guide-closed:${shop}`;
  const [closed, setClosed] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setClosed(localStorage.getItem(closedKey) === "1");
    } catch {
      setClosed(false); // storage blocked: open
    }
  }, [closedKey]);
  const toggle = () => {
    const next = closed !== true;
    setClosed(next);
    try {
      localStorage.setItem(closedKey, next ? "1" : "0");
    } catch {
      // storage blocked: this visit only
    }
  };

  const step = steps[cur];
  const ring = (doneCount / 5) * 131.9;

  return (
    <>
      {data.over.length > 0 && (
        <s-box paddingBlockEnd="base">
          <s-banner tone="warning" heading="You're over your plan's limits">
            The {data.planName} plan allows {listText(data.over)}. New rows or
            links are refused until you upgrade or remove some.
            <s-button
              slot="secondary-actions"
              onClick={() => navigate("/app/plans")}
            >
              Compare plans
            </s-button>
          </s-banner>
        </s-box>
      )}

      <s-section padding="none" accessibilityLabel="Setup guide">
        <div className="ff-guide">
          <div className="ff-g-head">
            <div
              className="ff-g-ring"
              role="img"
              aria-label={`${doneCount} of 5 steps done`}
            >
              <svg
                width="52"
                height="52"
                viewBox="0 0 52 52"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="ff-gr" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" style={{ stopColor: "var(--ff-p)" }} />
                    <stop offset="1" style={{ stopColor: "var(--ff-a)" }} />
                  </linearGradient>
                </defs>
                <circle
                  cx="26"
                  cy="26"
                  r="21"
                  fill="none"
                  stroke="#E5E7EB"
                  strokeWidth="5"
                />
                <circle
                  cx="26"
                  cy="26"
                  r="21"
                  fill="none"
                  stroke="url(#ff-gr)"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={`${ring} 131.9`}
                  transform="rotate(-90 26 26)"
                />
              </svg>
              <span>{doneCount}/5</span>
            </div>
            <div>
              <h2>{doneCount === 5 ? "You’re all set" : "Setup guide"}</h2>
              <p>
                {doneCount === 5
                  ? "Your search is live on your store."
                  : "Finish these steps to show the search on your store."}
              </p>
            </div>
            <button
              type="button"
              className="ff-g-toggle"
              onClick={toggle}
              aria-expanded={closed === false}
              aria-label={`${closed !== false ? "Show" : "Hide"} setup guide`}
            >
              <Icon
                name={closed !== false ? "down" : "up"}
                size={18}
                stroke={2.2}
              />
            </button>
          </div>
          {closed === false && (
            <>
              <div className="ff-g-seg" aria-hidden="true">
                {steps.map((s, i) => (
                  <span
                    key={s.label}
                    className={s.done ? "done" : i === firstOpen ? "cur" : ""}
                  />
                ))}
              </div>
              <ol className="ff-g-steps" aria-label="Setup steps">
                {steps.map((s, i) => (
                  <li key={s.label}>
                    <button
                      type="button"
                      className={[
                        s.done && "done",
                        i === firstOpen && "now",
                        i === cur && "cur",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-current={i === cur ? "step" : undefined}
                      onClick={() => setCur(i)}
                    >
                      <span className="ff-gs-ico">
                        <Icon
                          name={s.done ? "check" : s.icon}
                          size={14}
                          stroke={2.4}
                        />
                      </span>
                      <span className="ff-gs-status">
                        {STATUS(s.done, i === firstOpen)}
                      </span>
                      <span className="ff-gs-label">{s.label}</span>
                    </button>
                  </li>
                ))}
              </ol>
              <div className="ff-g-panel">
                <span className="ff-g-watermark" aria-hidden="true">
                  <Icon name={step.icon} size={104} stroke={1.2} />
                </span>
                <div className="ff-g-body">
                  <p className="ff-g-kicker">
                    <span
                      className={`ff-g-dot${step.done ? " is-done" : ""}`}
                      aria-hidden="true"
                    />
                    Step {cur + 1} ·{" "}
                    {step.done ? "Completed" : `About ${step.minutes} min`}
                  </p>
                  <h3>{step.title}</h3>
                  <p className="ff-g-desc">{step.description}</p>
                  <div className="ff-g-actions">
                    <s-button
                      variant={step.done ? "secondary" : "primary"}
                      onClick={() => navigate(step.to)}
                    >
                      {step.cta}
                    </s-button>
                    {cur < 4 && (
                      <s-button
                        variant="tertiary"
                        onClick={() => setCur(cur + 1)}
                      >
                        Next step
                      </s-button>
                    )}
                  </div>
                </div>
                <div className="ff-g-nav">
                  <button
                    type="button"
                    aria-label="Previous step"
                    disabled={cur === 0}
                    onClick={() => setCur(cur - 1)}
                  >
                    <Icon name="left" size={16} stroke={2.2} />
                  </button>
                  <button
                    type="button"
                    aria-label="Next step"
                    disabled={cur === 4}
                    onClick={() => setCur(cur + 1)}
                  >
                    <Icon name="right" size={16} stroke={2.2} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </s-section>

      <div className="ff-ov-title">
        <h2>Overview</h2>
      </div>
      <div className="ff-ov">
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            className="ff-ov-card"
            onClick={() => navigate(c.to)}
          >
            <span className="ff-ov-label">{c.label}</span>
            <span className="ff-ov-value">
              <span className="ff-ov-number">{c.value}</span>
              {c.badge && <s-badge tone={c.badge.tone}>{c.badge.text}</s-badge>}
            </span>
            <span className="ff-ov-line">{c.line}</span>
          </button>
        ))}
      </div>
    </>
  );
}
