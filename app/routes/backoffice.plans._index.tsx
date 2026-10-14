// Backoffice › Plans (/backoffice/plans): one glass card per plan with an Edit button
// (specs/backoffice.md). App-wide numbers live on the Overview. After a save the edit page comes
// back here with ?saved={key}: a toast.
import { useCallback, useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import {
  Link,
  useLoaderData,
  useNavigation,
  useSearchParams,
} from "react-router";
import { requireAdmin } from "../services/backoffice-auth.server";
import { getPlans, subscriberCounts } from "../models/plan.server";
import { fallbackPlan, formatLimit, formatPrice } from "../services/billing";
import {
  LIMIT_KEYS,
  LIMITS,
  limitOf,
  TOGGLE_KEYS,
  TOGGLES,
} from "../services/plan-features";
import { Icon, Spinner, Toast, toast } from "../components/backoffice/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  const [plans, counts] = await Promise.all([getPlans(), subscriberCounts()]);
  return { plans, counts, fallback: fallbackPlan(plans).key };
};

const n = (v: number) => v.toLocaleString("en-US");
const plural = (v: number, one: string, many: string) =>
  `${n(v)} ${v === 1 ? one : many}`;

export default function BackofficePlans() {
  const { plans, counts, fallback } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const navigation = useNavigation();
  const saved = plans.find((p) => p.key === params.get("saved"));
  const clearSaved = useCallback(
    () =>
      setParams(
        (p) => {
          p.delete("saved");
          return p;
        },
        { replace: true, preventScrollReset: true },
      ),
    [setParams],
  );

  // One toast per save; ?saved= is dropped from the URL when it hides.
  const savedName = saved?.name;
  const savedToast = useMemo(
    () => (savedName ? toast(`${savedName} saved`) : null),
    [savedName],
  );

  const opening =
    navigation.state === "loading" ? navigation.location.pathname : null;

  return (
    <>
      <div className="bo-head">
        <div>
          <h1 className="bo-title">Plans</h1>
          <p className="bo-sub">
            Prices, free trials, limits and features merchants see on the Plans
            page.
          </p>
        </div>
      </div>

      <div className="bo-plans">
        {plans.map((p) => {
          const href = `/backoffice/plans/${p.key}`;
          const features = TOGGLE_KEYS.filter((k) => p.toggles[k]);
          return (
            <article
              key={p.key}
              className={`bo-glass bo-plan${p.visible ? "" : " is-hidden"}`}
            >
              <div className="bo-plan-top">
                <div>
                  <h3>{p.name}</h3>
                  <p className="bo-plan-desc">{p.description}</p>
                </div>
                <div className="bo-badges">
                  {p.key === fallback && (
                    <span
                      className="bo-badge bo-badge--accent"
                      title="Stores without a plan get this plan's limits"
                    >
                      Default
                    </span>
                  )}
                  <span
                    className={`bo-badge bo-badge--dot${p.visible ? " bo-badge--success" : ""}`}
                  >
                    {p.visible ? "Shown" : "Hidden"}
                  </span>
                </div>
              </div>

              <div>
                <div className="bo-price">
                  {p.isFree ? "Free" : formatPrice(p.priceMonthly)}
                  {!p.isFree && <small>/ month</small>}
                </div>
              </div>
              {!p.isFree && (
                <div className="bo-price-alt">
                  {p.priceYearly !== null
                    ? `${formatPrice(p.priceYearly)} / year`
                    : "Monthly only"}
                  {" · "}
                  {p.trialDays
                    ? `${plural(p.trialDays, "day", "days")} free trial`
                    : "No trial"}
                </div>
              )}

              <ul className="bo-facts">
                {LIMIT_KEYS.map((k) => (
                  <li key={k}>
                    {LIMITS[k].label}
                    <b>{formatLimit(limitOf(p, k))}</b>
                  </li>
                ))}
              </ul>

              <div className="bo-features">
                {features.length ? (
                  features.map((k) => (
                    <span key={k} className="bo-badge bo-badge--info">
                      {TOGGLES[k].label}
                    </span>
                  ))
                ) : (
                  <span className="bo-help">No extra features</span>
                )}
              </div>

              <div className="bo-plan-foot">
                <span className="bo-help">
                  <Icon name="store" size={14} />{" "}
                  {plural(counts[p.key] ?? 0, "store", "stores")}
                </span>
                <Link
                  to={href}
                  className="bo-btn bo-btn--sm"
                  aria-label={`Edit ${p.name}`}
                >
                  {opening === href ? (
                    <Spinner />
                  ) : (
                    <Icon name="edit" size={15} />
                  )}
                  Edit
                </Link>
              </div>
            </article>
          );
        })}
      </div>

      <Toast message={savedToast} onDone={clearSaved} />
    </>
  );
}
