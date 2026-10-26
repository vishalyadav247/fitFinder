// Plans: the current plan with usage meters, and the plans set up in the backoffice. A paid plan
// creates a Billing API charge and opens Shopify's approval page; a free plan cancels the charge
// after a confirm modal.
// Spec: .claude/specs/plans.md
import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { z } from "zod";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { getPlans } from "../models/plan.server";
import { shopPlan, usage } from "../services/billing.server";
import {
  BillingError,
  startSubscription,
  switchToFree,
  trialDaysUsed,
} from "../services/subscription.server";
import {
  effectivePlan,
  formatLimit,
  formatPrice,
  limitsOf,
  cardLines,
  trialDaysFor,
  trialDaysLeft,
  visiblePlans,
  type PlanView,
} from "../services/billing";
import styles from "../styles/plans.css?url";
import { SectionTitle } from "../components/SectionTitle";
import { PageHeader } from "../components/PageHeader";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  // The merchant came here to see or change the plan: read it fresh. Back from Shopify's
  // approval page (returnUrl ?charge=1, Shopify adds charge_id), always: the 10 s limit on
  // forced reads would otherwise show the old plan after a quick approval.
  const url = new URL(request.url);
  const backFromApproval =
    url.searchParams.has("charge") || url.searchParams.has("charge_id");
  const [plan, used, plans, trialUsed] = await Promise.all([
    shopPlan(admin.graphql, shop.id, {
      force: true,
      bypassThrottle: backFromApproval,
    }),
    usage(shop.id),
    getPlans(),
    trialDaysUsed(shop.id),
  ]);
  return {
    plan: plan.plan,
    chosen: plan.plan !== "none",
    fresh: plan.fresh,
    trialDays: trialDaysLeft(plan.trialEndsAt),
    trialUsed,
    used,
    plans,
  };
};

const ActionInput = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("subscribe"),
    plan: z.string().min(1).max(40),
    interval: z.enum(["monthly", "yearly"]),
  }),
  z.object({ intent: z.literal("free"), plan: z.string().min(1).max(40) }),
]);

type ActionResult =
  | { ok: true; confirmationUrl?: string; toast?: string }
  | { ok: false; error: string };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const parsed = ActionInput.safeParse(
    Object.fromEntries(await request.formData()),
  );
  if (!parsed.success) {
    return data<ActionResult>(
      {
        ok: false,
        error: "Something went wrong. Reload the page and try again.",
      },
      { status: 400 },
    );
  }
  try {
    if (parsed.data.intent === "subscribe") {
      const { confirmationUrl } = await startSubscription(
        admin.graphql,
        { id: shop.id, domain: session.shop },
        parsed.data.plan,
        parsed.data.interval,
      );
      return data<ActionResult>({ ok: true, confirmationUrl });
    }
    await switchToFree(admin.graphql, shop.id, parsed.data.plan);
    return data<ActionResult>({ ok: true, toast: "Plan changed" });
  } catch (error) {
    if (error instanceof BillingError) {
      return data<ActionResult>(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }
    console.error("plans: action failed", { shop: session.shop, error });
    return data<ActionResult>(
      { ok: false, error: "Your plan couldn't be changed. Please try again." },
      { status: 500 },
    );
  }
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
      <div className={`sp-meter${used > max ? " is-over" : ""}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </s-stack>
  );
}

const FREE_MODAL = "free-plan-modal";

export default function PlansPage() {
  const data = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [yearly, setYearly] = useState(false);
  const [freeTarget, setFreeTarget] = useState<PlanView | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const plans = visiblePlans(data.plans, data.plan);
  const current = effectivePlan(data.plans, data.plan);
  const limits = limitsOf(current);
  const currentIndex = plans.findIndex((p) => p.key === current.key);
  const hasYearly = plans.some((p) => !p.isFree && p.priceYearly !== null);
  const trials = plans
    .filter((p) => !p.isFree)
    .map((p) => trialDaysFor(p, data.trialUsed));
  const sameTrial = trials.length > 0 && trials.every((t) => t === trials[0]);

  const result = fetcher.data;
  useEffect(() => {
    if (!result) return;
    if (!result.ok) {
      shopify.toast.show(result.error, { isError: true });
      return;
    }
    // Shopify's approval page is outside the app frame.
    if (result.confirmationUrl) window.open(result.confirmationUrl, "_top");
    if (result.toast) {
      shopify.modal.hide(FREE_MODAL);
      shopify.toast.show(result.toast);
    }
  }, [result, shopify]);
  useEffect(() => {
    if (fetcher.state === "idle") setPending(null);
  }, [fetcher.state]);

  const busy = fetcher.state !== "idle";
  const showYearly = yearly && hasYearly;
  const price = (p: PlanView) => {
    if (p.isFree) return "Free";
    const n =
      showYearly && p.priceYearly !== null ? p.priceYearly : p.priceMonthly;
    return formatPrice(n);
  };
  const per = (p: PlanView) =>
    p.isFree
      ? ""
      : showYearly && p.priceYearly !== null
        ? " / year"
        : " / month";

  const choose = (p: PlanView) => {
    // Nothing to cancel before the first plan: no confirm needed.
    if (p.isFree && !data.chosen) {
      setPending(p.key);
      fetcher.submit({ intent: "free", plan: p.key }, { method: "post" });
      return;
    }
    if (p.isFree) {
      setFreeTarget(p);
      shopify.modal.show(FREE_MODAL);
      return;
    }
    setPending(p.key);
    fetcher.submit(
      {
        intent: "subscribe",
        plan: p.key,
        interval: showYearly && p.priceYearly !== null ? "yearly" : "monthly",
      },
      { method: "post" },
    );
  };
  const confirmFree = () => {
    if (!freeTarget) return;
    setPending(freeTarget.key);
    fetcher.submit(
      { intent: "free", plan: freeTarget.key },
      { method: "post" },
    );
  };

  return (
    <s-page inlineSize="base">
      <PageHeader title="Plans" />
      <s-stack gap="base">
        {!data.fresh && (
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
                  : `You haven't picked a plan yet, so ${current.name}'s limits apply. Pick a plan below; it's billed through Shopify on your Shopify invoice.`}
              </s-text>
            </s-stack>
            <s-stack gap="base">
              <Meter
                label="Filter rows"
                used={data.used.rows}
                max={limits.rows}
              />
              <Meter
                label="Linked products"
                used={data.used.products}
                max={limits.products}
              />
            </s-stack>
          </s-grid>
        </s-section>

        <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
          <s-text color="subdued">
            {sameTrial && trials[0] > 0
              ? `Every paid plan starts with a ${trials[0]}-day free trial.`
              : ""}
          </s-text>
          {hasYearly && (
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
                Yearly
              </s-button>
            </s-stack>
          )}
        </s-grid>

        <div className={`sp-plans sp-plans--${Math.min(plans.length, 4)}`}>
          {plans.map((p, i) => {
            const isCurrent = data.chosen && p.key === current.key;
            const trial = trialDaysFor(p, data.trialUsed);
            return (
              <s-section key={p.key} accessibilityLabel={p.name}>
                <div className="sp-plan">
                  <s-stack gap="base">
                    <s-stack
                      direction="inline"
                      gap="small-200"
                      alignItems="center"
                    >
                      <h2 className="sp-sec-title">{p.name}</h2>
                      {isCurrent && (
                        <s-badge tone="success">Current plan</s-badge>
                      )}
                    </s-stack>
                    <p className="sp-price">
                      {price(p)}
                      <span>{per(p)}</span>
                    </p>
                    {p.description && (
                      <s-text color="subdued">{p.description}</s-text>
                    )}
                    {!sameTrial && trial > 0 && !isCurrent && (
                      <s-text color="subdued">{`${trial}-day free trial`}</s-text>
                    )}
                    <s-unordered-list>
                      {cardLines(p).map((x, i) => (
                        <s-list-item key={i}>{x}</s-list-item>
                      ))}
                    </s-unordered-list>
                  </s-stack>
                  {/* Bottom of the card, so the buttons line up across plans. */}
                  <div className="sp-plan-cta">
                    {isCurrent ? (
                      <s-button disabled>Current plan</s-button>
                    ) : (
                      <s-button
                        variant={
                          i > currentIndex || !data.chosen
                            ? "primary"
                            : undefined
                        }
                        loading={pending === p.key && busy}
                        disabled={busy && pending !== p.key}
                        onClick={() => choose(p)}
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

      <s-modal
        id={FREE_MODAL}
        heading={freeTarget ? `Switch to ${freeTarget.name}?` : "Switch plan?"}
        size="small"
      >
        <s-paragraph>
          {freeTarget
            ? `Your current plan is cancelled right away and ${freeTarget.name}'s limits apply. Features your new plan doesn't include stop showing in your store.`
            : ""}
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={busy}
          onClick={confirmFree}
        >
          Switch plan
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor={FREE_MODAL}
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}
