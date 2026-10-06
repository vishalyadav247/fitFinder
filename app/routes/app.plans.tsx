// Plans: the current plan with usage meters, and the three plans. Shopify App Pricing hosts the
// plan selection and approval page; the buttons open it.
// Spec: .claude/specs/plans.md · Prototype: .claude/design/scripts/screens/plans.js
import { useState } from "react";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { appHandle, shopPlan, usage } from "../services/billing.server";
import {
  effectivePlan,
  formatLimit,
  PLANS,
  planSelectionUrl,
  trialDaysLeft,
  type Plan,
} from "../services/billing";
import styles from "../styles/plans.css?url";
import { SectionTitle } from "../components/SectionTitle";
import { PageHeader } from "../components/PageHeader";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  // The merchant came here to see or change the plan: read it fresh.
  const [plan, used] = await Promise.all([
    shopPlan(admin.graphql, shop.id, { force: true }),
    usage(shop.id),
  ]);
  const handle = appHandle();
  return {
    plan: plan.connected ? plan.plan : "none",
    chosen: plan.connected && plan.plan !== "none",
    connected: plan.connected && !!handle,
    fresh: plan.fresh,
    trialDays: trialDaysLeft(plan.trialEndsAt),
    used,
    planUrl: handle ? planSelectionUrl(session.shop, handle) : null,
  };
};

function Meter({
  label,
  used,
  max,
}: {
  label: string;
  used: number;
  max: number;
}) {
  const pct =
    max === Infinity ? 2 : Math.max(2, Math.min(100, (used / max) * 100));
  return (
    <s-stack gap="small-100">
      <s-grid gridTemplateColumns="1fr auto" gap="base">
        <s-text>{label}</s-text>
        <s-text color="subdued">
          {formatLimit(used)} of {formatLimit(max)}
        </s-text>
      </s-grid>
      <div className={`ff-meter${used > max ? " is-over" : ""}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </s-stack>
  );
}

export default function PlansPage() {
  const data = useLoaderData<typeof loader>();
  const [yearly, setYearly] = useState(false);
  const current = effectivePlan(data.plan);
  const currentIndex = PLANS.indexOf(current);
  // Shopify's plan page is outside the app frame.
  const openPlans = () => {
    if (data.planUrl) window.open(data.planUrl, "_top");
  };
  const price = (p: Plan) =>
    p.month === 0 ? "Free" : `$${yearly ? p.month * 10 : p.month}`;
  const per = (p: Plan) =>
    p.month === 0 ? "" : yearly ? " / year" : " / month";

  return (
    <s-page inlineSize="base">
      <PageHeader title="Plans" />
      <s-stack gap="base">
        {!data.connected && (
          <s-banner tone="warning" heading="Plans can't be changed here yet">
            Billing isn&apos;t connected in this environment, so Starter&apos;s
            limits apply.
          </s-banner>
        )}
        {data.connected && !data.fresh && (
          <s-banner tone="warning" heading="Your plan couldn't be checked">
            Showing the plan from the last check. Reload the page to try again.
          </s-banner>
        )}
        <s-section accessibilityLabel="Your plan">
          <s-grid
            gridTemplateColumns="minmax(0, 1fr) minmax(0, 1fr)"
            gap="large"
            alignItems="start"
          >
            <s-stack gap="small-200">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <SectionTitle icon="plan">
                  Your plan: {current.name}
                </SectionTitle>
                {data.chosen && data.trialDays > 0 && (
                  <s-badge tone="info">
                    {`Free trial · ${data.trialDays} day${data.trialDays === 1 ? "" : "s"} left`}
                  </s-badge>
                )}
              </s-stack>
              <s-text color="subdued">
                {data.chosen
                  ? "Billed through Shopify on your Shopify invoice. You can change or cancel your plan any time."
                  : "You haven't picked a plan yet, so Starter's limits apply. Pick a plan below; it's billed through Shopify on your Shopify invoice."}
              </s-text>
            </s-stack>
            <s-stack gap="base">
              <Meter
                label="Filter rows"
                used={data.used.rows}
                max={current.limits.rows}
              />
              <Meter
                label="Linked products"
                used={data.used.products}
                max={current.limits.products}
              />
            </s-stack>
          </s-grid>
        </s-section>

        <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
          <s-text color="subdued">
            Every paid plan starts with a 14-day free trial.
          </s-text>
          <s-stack direction="inline" gap="small-200">
            <s-button
              variant={yearly ? "tertiary" : "secondary"}
              onClick={() => setYearly(false)}
            >
              Monthly
            </s-button>
            <s-button
              variant={yearly ? "secondary" : "tertiary"}
              onClick={() => setYearly(true)}
            >
              Yearly · 2 months free
            </s-button>
          </s-stack>
        </s-grid>

        <div className="ff-plans">
          {PLANS.map((p, i) => {
            const isCurrent = data.chosen && p === current;
            return (
              <s-section key={p.key} accessibilityLabel={p.name}>
                <div className="ff-plan">
                  <s-stack gap="base">
                    <s-stack
                      direction="inline"
                      gap="small-200"
                      alignItems="center"
                    >
                      <h2 className="ff-sec-title">{p.name}</h2>
                      {isCurrent && (
                        <s-badge tone="success">Current plan</s-badge>
                      )}
                    </s-stack>
                    <p className="ff-price">
                      {price(p)}
                      <span>{per(p)}</span>
                    </p>
                    <s-text color="subdued">{p.sub}</s-text>
                    <s-unordered-list>
                      {p.items.map((x) => (
                        <s-list-item key={x}>{x}</s-list-item>
                      ))}
                    </s-unordered-list>
                  </s-stack>
                  {/* Bottom of the card, so the buttons line up across plans. */}
                  <div className="ff-plan-cta">
                    {isCurrent ? (
                      <s-button disabled>Current plan</s-button>
                    ) : (
                      <s-button
                        variant={
                          i > currentIndex || !data.chosen
                            ? "primary"
                            : undefined
                        }
                        disabled={!data.connected || !data.planUrl}
                        onClick={openPlans}
                      >
                        {!data.chosen
                          ? `Choose ${p.name}`
                          : i > currentIndex
                            ? `Upgrade to ${p.name}`
                            : `Switch to ${p.name}`}
                      </s-button>
                    )}
                  </div>
                </div>
              </s-section>
            );
          })}
        </div>
      </s-stack>
    </s-page>
  );
}
