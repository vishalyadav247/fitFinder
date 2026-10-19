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
  LIMIT_KEYS,
  LIMITS,
  MAX_BULLETS,
  MAX_TRIAL_DAYS,
  planInputSchema,
  TOGGLE_KEYS,
  TOGGLES,
  type PlanLimits,
  type PlanToggles,
  type PlanView,
} from "../services/plan-features";
import { formToPlanInput } from "../services/backoffice-form";
import { mergeCardLines, planLines } from "../services/billing";
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

/** The generated card lines for what the form says now (limits and features not saved yet). */
function draftLines(form: HTMLFormElement | null, plan: PlanView): string[] {
  if (!form) return planLines(plan);
  const raw = formToPlanInput(new FormData(form));
  const limits = Object.fromEntries(
    LIMIT_KEYS.map((k) => {
      const v = raw.limits[k];
      const n = Number(v);
      return [k, v === null ? null : Number.isFinite(n) ? n : 0];
    }),
  ) as PlanLimits;
  return planLines({ ...plan, limits, toggles: raw.toggles as PlanToggles });
}

interface ExtraLine {
  id: number;
  text: string;
  at: number;
}

/**
 * Card lines: the card as merchants see it. Generated lines (limits and features) are fixed; the
 * plan's own lines can be added, edited, moved between them and removed. Each own line is sent as
 * "line.text" + "line.at" (generated lines before it), in card order.
 */
function CardLines({
  plan,
  formRef,
  onChange,
  error,
}: {
  plan: PlanView;
  formRef: React.RefObject<HTMLFormElement | null>;
  onChange: () => void;
  error?: string;
}) {
  const [generated, setGenerated] = useState(() => planLines(plan));
  const [extras, setExtras] = useState<ExtraLine[]>(() =>
    plan.bullets.map((text, i) => ({
      id: i,
      text,
      at: plan.bulletsAt?.[i] ?? Infinity,
    })),
  );
  const nextId = useRef(plan.bullets.length);
  const focusId = useRef<number | null>(null);

  // Generated lines follow the limits and features as they are edited.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const update = () => setGenerated(draftLines(form, plan));
    update();
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    return () => {
      form.removeEventListener("input", update);
      form.removeEventListener("change", update);
    };
  }, [formRef, plan]);

  useEffect(() => {
    if (focusId.current === null) return;
    document.getElementById(`line-${focusId.current}`)?.focus();
    focusId.current = null;
  });

  const items = mergeCardLines(generated, extras);
  const edit = (next: ExtraLine[]) => {
    setExtras(next);
    onChange();
  };
  const move = (index: number, dir: -1 | 1) => {
    const item = items[index];
    const other = items[index + dir];
    if (item.extra === null || !other) return;
    const next = extras.map((e) => ({
      ...e,
      at: Math.min(e.at, generated.length),
    }));
    if (other.extra === null) {
      // Past a generated line: one place up or down.
      next[item.extra] = { ...next[item.extra], at: next[item.extra].at + dir };
    } else {
      // Past another own line in the same place: swap them.
      [next[item.extra], next[other.extra]] = [
        next[other.extra],
        next[item.extra],
      ];
    }
    edit(next);
  };
  const add = () => {
    const id = nextId.current++;
    focusId.current = id;
    edit([...extras, { id, text: "", at: generated.length }]);
  };

  let before = 0;
  return (
    <>
      <p className="bo-help" style={{ marginTop: 0 }}>
        The plan card as merchants see it. Grey lines come from the limits and
        features above; add your own lines and move them with the arrows.
      </p>
      <ul className="bo-cardlines">
        {items.map((item, i) => {
          if (item.extra === null) {
            before++;
            return (
              <li key={`g${i}`} className="bo-cardline is-auto">
                <span className="bo-cardline-text">{item.text}</span>
                <span className="bo-help">Automatic</span>
              </li>
            );
          }
          const line = extras[item.extra];
          return (
            <li key={line.id} className="bo-cardline">
              <input
                id={`line-${line.id}`}
                className="bo-input"
                name="line.text"
                value={line.text}
                maxLength={120}
                placeholder="Your line, e.g. Priority email support"
                aria-label="Card line"
                onChange={(e) =>
                  edit(
                    extras.map((x) =>
                      x.id === line.id
                        ? { ...x, text: e.currentTarget.value }
                        : x,
                    ),
                  )
                }
              />
              <input type="hidden" name="line.at" value={before} />
              <button
                type="button"
                className="bo-btn bo-btn--ghost bo-btn--sm bo-btn--icon"
                aria-label="Move up"
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <Icon name="up" size={16} />
              </button>
              <button
                type="button"
                className="bo-btn bo-btn--ghost bo-btn--sm bo-btn--icon"
                aria-label="Move down"
                disabled={i === items.length - 1}
                onClick={() => move(i, 1)}
              >
                <Icon name="down" size={16} />
              </button>
              <button
                type="button"
                className="bo-btn bo-btn--ghost bo-btn--sm bo-btn--icon"
                aria-label="Remove line"
                onClick={() => edit(extras.filter((x) => x.id !== line.id))}
              >
                <Icon name="trash" size={16} />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="bo-cardlines-foot">
        <button
          type="button"
          className="bo-btn bo-btn--sm"
          onClick={add}
          disabled={extras.length >= MAX_BULLETS}
        >
          <Icon name="plus" size={15} />
          Add line
        </button>
        <span className="bo-help">
          {extras.length >= MAX_BULLETS
            ? `${MAX_BULLETS} lines is the most a card can have.`
            : `Up to ${MAX_BULLETS} lines of 120 characters.`}
        </span>
      </div>
      <FieldError message={error} />
    </>
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
  const {
    dirty,
    setDirty,
    discard,
    shake,
    submitting: saving,
  } = useDirtyForm(formRef);
  // Discard rebuilds the card lines editor from the saved plan.
  const [linesKey, setLinesKey] = useState(0);
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
          setLinesKey((n) => n + 1);
          setIsFree(plan.isFree);
          setUnlimited(initialUnlimited());
        }}
      />
      <Toast message={notice} />
      <div className="bo-head">
        <div>
          {/* Back to Plans sits in the title, in the title's font: "Plans › Edit Starter". */}
          <h1 className="bo-title">
            <Link to="/backoffice/plans" className="bo-crumb">
              <Icon name="back" size={22} />
              Plans
            </Link>
            <span className="bo-crumb-sep" aria-hidden="true">
              ›
            </span>
            Edit {plan.name}
          </h1>
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

        {/* Limits left, Features right (one column on narrow screens). */}
        <section className="bo-glass bo-card">
          <SectionTitle icon="gauge">Limits</SectionTitle>
          <div className="bo-fields bo-fields--stack">
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
                  placeholder={unlimited[k] ? "Unlimited" : undefined}
                  defaultValue={plan.limits[k] ?? ""}
                  disabled={unlimited[k]}
                  required={!unlimited[k]}
                />
                <Toggle
                  name={`unlimited.${k}`}
                  label="Unlimited"
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

        <section className="bo-glass bo-card bo-card--wide">
          <SectionTitle icon="list">Card lines</SectionTitle>
          <CardLines
            key={linesKey}
            plan={plan}
            formRef={formRef}
            onChange={() => setDirty(true)}
            error={errors.bullets}
          />
        </section>
      </div>
    </Form>
  );
}
