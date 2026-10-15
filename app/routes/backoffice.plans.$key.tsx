// Backoffice › Edit plan: name, pricing, free trial, limits, features and card lines
// (specs/backoffice.md). Validated with plan-features.ts planInputSchema.
import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
} from "react-router";
import { checkOrigin, requireAdmin } from "../services/backoffice-auth.server";
import { getPlan, PlanRuleError, updatePlan } from "../models/plan.server";
import {
  HARD_LIMITS,
  LIMIT_KEYS,
  LIMITS,
  MAX_TRIAL_DAYS,
  planInputSchema,
  TOGGLE_KEYS,
  TOGGLES,
} from "../services/plan-features";
import { formToPlanInput } from "../services/backoffice-form";
import {
  Icon,
  SaveBar,
  Toast,
  toast,
  useDirtyForm,
  type IconName,
  type ToastMessage,
} from "../components/backoffice/ui";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await requireAdmin(request);
  const plan = await getPlan(params.key ?? "");
  if (!plan) throw new Response("Not Found", { status: 404 });
  return { plan };
};

type ActionResult = { error: string; errors: Record<string, string> };

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { email } = await requireAdmin(request);
  checkOrigin(request);
  const key = params.key ?? "";
  const parsed = planInputSchema.safeParse(
    formToPlanInput(await request.formData()),
  );
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      // "bullets.3" shows under the card lines; "limits.rows" under its own box.
      const [head, sub] = issue.path.map(String);
      const key = head === "limits" && sub ? `limits.${sub}` : head;
      errors[key] ??= issue.message;
    }
    return data<ActionResult>(
      { errors, error: "Check the highlighted fields." },
      { status: 400 },
    );
  }
  try {
    await updatePlan(key, parsed.data, email);
  } catch (error) {
    if (error instanceof PlanRuleError) {
      return data<ActionResult>(
        { errors: {}, error: error.message },
        { status: 400 },
      );
    }
    throw error;
  }
  console.info("backoffice: plan saved", { key, by: email });
  return redirect(`/backoffice/plans?saved=${encodeURIComponent(key)}`);
};

function FieldError({ message }: { message?: string }) {
  return message ? <span className="bo-error">{message}</span> : null;
}

function Toggle({
  name,
  label,
  help,
  checked,
  defaultChecked,
  onChange,
}: {
  name: string;
  label: string;
  help?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className="bo-toggle">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        defaultChecked={defaultChecked}
        onChange={
          onChange ? (e) => onChange(e.currentTarget.checked) : undefined
        }
      />
      <span className="bo-switch" aria-hidden="true" />
      <span className="bo-toggle-text">
        <b>{label}</b>
        {help && <span className="bo-help">{help}</span>}
      </span>
    </label>
  );
}

function SectionTitle({
  icon,
  children,
}: {
  icon: IconName;
  children: string;
}) {
  return (
    <h2 className="bo-section-title">
      <span className="bo-chip-icon">
        <Icon name={icon} size={16} />
      </span>
      {children}
    </h2>
  );
}

export default function EditPlan() {
  const { plan } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const errors = result?.errors ?? {};
  const initialUnlimited = () =>
    Object.fromEntries(LIMIT_KEYS.map((k) => [k, plan.limits[k] === null]));
  const [isFree, setIsFree] = useState(plan.isFree);
  const [unlimited, setUnlimited] =
    useState<Record<string, boolean>>(initialUnlimited);
  const formRef = useRef<HTMLFormElement>(null);
  // Saving lasts from the post until the plans page has loaded after the redirect.
  const { dirty, discard, shake, submitting: saving } = useDirtyForm(formRef);
  const [notice, setNotice] = useState<ToastMessage | null>(null);
  useEffect(() => {
    if (result?.error) setNotice(toast(result.error, true));
  }, [result]);
  const cls = (key: string) => `bo-input${errors[key] ? " has-error" : ""}`;

  return (
    <Form method="post" id="plan-form" ref={formRef}>
      <SaveBar
        formId="plan-form"
        visible={dirty}
        saving={saving}
        shake={shake}
        onDiscard={() => {
          discard();
          setIsFree(plan.isFree);
          setUnlimited(initialUnlimited());
        }}
      />
      <Toast message={notice} />
      <div className="bo-head">
        <div>
          <Link to="/backoffice/plans" className="bo-eyebrow">
            <Icon name="back" size={16} /> Plans
          </Link>
          <h1 className="bo-title">Edit {plan.name}</h1>
          <p className="bo-sub">
            Changes to limits and features apply right away. Price and trial
            changes apply to new subscriptions.
          </p>
        </div>
      </div>

      <div className="bo-form-grid">
        <section className="bo-glass bo-card">
          <SectionTitle icon="list">General</SectionTitle>
          <label className="bo-field">
            <span className="bo-label">Name</span>
            <input
              className={cls("name")}
              name="name"
              defaultValue={plan.name}
              maxLength={40}
              required
            />
            <FieldError message={errors.name} />
          </label>
          <label className="bo-field">
            <span className="bo-label">Description</span>
            <input
              className={cls("description")}
              name="description"
              defaultValue={plan.description}
              maxLength={160}
            />
            <span className="bo-help">
              One line under the price on the plan card.
            </span>
            <FieldError message={errors.description} />
          </label>
          <Toggle
            name="visible"
            label="Show this plan to merchants"
            help="Hidden plans can't be picked; stores already on them keep them."
            defaultChecked={plan.visible}
          />
          <FieldError message={errors.visible} />
        </section>

        <section className="bo-glass bo-card">
          <SectionTitle icon="money">Pricing and trial</SectionTitle>
          <Toggle
            name="isFree"
            label="Free plan"
            help="No charge and no trial. Stores without a plan get the first free plan's limits."
            checked={isFree}
            onChange={setIsFree}
          />
          {!isFree && (
            <div className="bo-fields" style={{ marginTop: 12 }}>
              <label className="bo-field">
                <span className="bo-label">Monthly price (USD)</span>
                <span className="bo-prefix">
                  <span>$</span>
                  <input
                    className={cls("priceMonthly")}
                    name="priceMonthly"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={plan.priceMonthly || ""}
                    required
                  />
                </span>
                <FieldError message={errors.priceMonthly} />
              </label>
              <label className="bo-field">
                <span className="bo-label">Yearly price (USD)</span>
                <span className="bo-prefix">
                  <span>$</span>
                  <input
                    className={cls("priceYearly")}
                    name="priceYearly"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Monthly only"
                    defaultValue={plan.priceYearly ?? ""}
                  />
                </span>
                <span className="bo-help">Leave empty for monthly only.</span>
                <FieldError message={errors.priceYearly} />
              </label>
              <label className="bo-field">
                <span className="bo-label">Free trial (days)</span>
                <input
                  className={cls("trialDays")}
                  name="trialDays"
                  type="number"
                  min="0"
                  max={MAX_TRIAL_DAYS}
                  step="1"
                  defaultValue={plan.isFree ? 14 : plan.trialDays}
                  required
                />
                <span className="bo-help">
                  0 for no trial. Days a store already used are taken off.
                </span>
                <FieldError message={errors.trialDays} />
              </label>
            </div>
          )}
        </section>

        <section className="bo-glass bo-card bo-card--wide">
          <SectionTitle icon="gauge">Limits</SectionTitle>
          <div className="bo-fields">
            {LIMIT_KEYS.map((k) => (
              <div className="bo-limit" key={k}>
                <label className="bo-field" htmlFor={`limit-${k}`}>
                  <span className="bo-label">{LIMITS[k].label}</span>
                </label>
                <input
                  id={`limit-${k}`}
                  className={cls(`limits.${k}`)}
                  name={`limit.${k}`}
                  type="number"
                  min="0"
                  step="1"
                  max={HARD_LIMITS[k]}
                  placeholder={unlimited[k] ? "Unlimited" : undefined}
                  defaultValue={plan.limits[k] ?? ""}
                  disabled={unlimited[k]}
                  required={!unlimited[k]}
                />
                <Toggle
                  name={`unlimited.${k}`}
                  label={
                    k === "searchFields"
                      ? `Up to the maximum (${HARD_LIMITS[k]})`
                      : "Unlimited"
                  }
                  checked={unlimited[k]}
                  onChange={(checked) =>
                    setUnlimited((u) => ({ ...u, [k]: checked }))
                  }
                />
                <span className="bo-help">{LIMITS[k].help}</span>
                <FieldError message={errors[`limits.${k}`]} />
              </div>
            ))}
          </div>
          <p className="bo-help" style={{ marginTop: 12 }}>
            Lowering a limit never deletes data: stores over it see a warning
            and can&apos;t add more until they remove some or upgrade.
          </p>
        </section>

        <section className="bo-glass bo-card">
          <SectionTitle icon="spark">Features</SectionTitle>
          <div className="bo-toggles" style={{ gridTemplateColumns: "1fr" }}>
            {TOGGLE_KEYS.map((k) => (
              <Toggle
                key={k}
                name={`toggle.${k}`}
                label={TOGGLES[k].label}
                help={TOGGLES[k].help}
                defaultChecked={plan.toggles[k]}
              />
            ))}
          </div>
          <FieldError message={errors.toggles} />
        </section>

        <section className="bo-glass bo-card">
          <SectionTitle icon="list">Extra card lines</SectionTitle>
          <label className="bo-field">
            <span className="bo-label">One line per row</span>
            <textarea
              className={cls("bullets")}
              name="bullets"
              rows={6}
              defaultValue={plan.bullets.join("\n")}
              placeholder="Unlimited filter rows"
            />
            <span className="bo-help">
              Shown on the plan card after the limits and features (up to 12
              lines).
            </span>
            <FieldError message={errors.bullets} />
          </label>
        </section>
      </div>
    </Form>
  );
}
