// Onboarding: pick the store type. Spec: .claude/specs/onboarding.md
// Prototype: .claude/design/scripts/screens/onboarding.js
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { StoreType } from "@prisma/client";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import {
  SetupExistsError,
  applyStoreType,
  getSearchConfig,
  getSetupCounts,
  setupInputSchema,
} from "../models/search-config.server";
import {
  STORE_TYPES,
  STORE_TYPE_KEYS,
  type StoreIcon,
} from "../services/store-types";
import styles from "../styles/onboarding.css?url";
import { PageHeader } from "../components/PageHeader";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const config = await getSearchConfig(shop.id);
  return {
    current: config?.storeType ?? null,
    counts: config ? await getSetupCounts(shop.id) : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);

  const parsed = setupInputSchema.safeParse(
    Object.fromEntries(await request.formData()),
  );
  if (!parsed.success) {
    return data({ error: "Choose a store type." }, { status: 400 });
  }

  try {
    await applyStoreType(shop.id, parsed.data.storeType, {
      replace: parsed.data.replace,
    });
  } catch (error) {
    if (error instanceof SetupExistsError) {
      return data({ error: error.message }, { status: 409 });
    }
    console.error("onboarding: applyStoreType failed", {
      shop: session.shop,
      ...parsed.data,
      error,
    });
    return data(
      { error: "Your setup couldn't be saved. Try again." },
      { status: 500 },
    );
  }
  return redirect("/app");
};

// Icon paths from .claude/design/scripts/core/icons.js (20×20, stroke icons).
const ICONS: Record<StoreIcon, string> = {
  car: '<path d="M3 13v-2.5L5 6h10l2 4.5V13z"/><circle cx="6.5" cy="13.5" r="1.5"/><circle cx="13.5" cy="13.5" r="1.5"/>',
  phone:
    '<rect x="6" y="2.5" width="8" height="15" rx="2"/><path d="M9 15h2"/>',
  beauty:
    '<rect x="7" y="8" width="6" height="9.5" rx="1.5"/><path d="M8 8V5.5l4-3V8"/>',
  spark:
    '<path d="M10 2v4M10 14v4M2 10h4M14 10h4M4.5 4.5l2.5 2.5M13 13l2.5 2.5M4.5 15.5 7 13M13 7l2.5-2.5"/>',
};

function Icon({ name }: { name: StoreIcon }) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

const REPLACE_MODAL = "replace-setup-modal";

const plural = (n: number, word: string) =>
  `${n.toLocaleString("en")} ${word}${n === 1 ? "" : "s"}`;

export default function Onboarding() {
  const { current, counts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [choice, setChoice] = useState<StoreType>(current ?? "automotive");
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const changing = current !== null;
  const busy = fetcher.state !== "idle";
  const preset = STORE_TYPES[choice];
  // Keyed on the response object, so the same error twice in a row still shows a toast.
  const result = fetcher.data;
  useEffect(() => {
    if (result && "error" in result) {
      shopify.toast.show(result.error, { isError: true });
    }
  }, [result, shopify]);

  const submit = (replace: boolean) =>
    fetcher.submit(
      { storeType: choice, replace: String(replace) },
      { method: "post" },
    );

  // Arrow keys move between cards, as in a native radio group.
  const onCardKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const next =
      (index + step + STORE_TYPE_KEYS.length) % STORE_TYPE_KEYS.length;
    setChoice(STORE_TYPE_KEYS[next]);
    cardRefs.current[next]?.focus();
  };

  return (
    <s-page inlineSize="base">
      <PageHeader title="Welcome to FitFinder" />
      <div className="ff-onboarding">
        <s-stack gap="base">
          {changing && (
            <s-banner
              tone="warning"
              heading="Changing your store type replaces your search fields and filter data"
            >
              <s-paragraph>
                Export your data first if you want to keep it.{" "}
                <s-link href="/app/settings">Keep my current setup</s-link>
              </s-paragraph>
            </s-banner>
          )}

          <s-section>
            <s-stack gap="base">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-badge tone="info">Step 1 of 2</s-badge>
                <s-heading>
                  What kind of products does your store sell?
                </s-heading>
              </s-stack>
              <s-paragraph color="subdued">
                We&apos;ll set up search fields that fit. You can rename, add or
                remove fields any time.
              </s-paragraph>
              <div
                className="ff-types"
                role="radiogroup"
                aria-label="Store type"
              >
                {STORE_TYPE_KEYS.map((key, index) => {
                  const t = STORE_TYPES[key];
                  const selected = key === choice;
                  return (
                    <button
                      key={key}
                      ref={(el) => {
                        cardRefs.current[index] = el;
                      }}
                      type="button"
                      className="ff-type"
                      role="radio"
                      aria-checked={selected}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setChoice(key)}
                      onKeyDown={(e) => onCardKey(e, index)}
                    >
                      <span className="ff-type-top">
                        <span className={`ff-tile ${t.tile}`}>
                          <Icon name={t.icon} />
                        </span>
                        {selected && (
                          <s-badge tone="success" icon="check-circle">
                            Selected
                          </s-badge>
                        )}
                      </span>
                      <b>{t.label}</b>
                      <span className="ff-type-blurb">{t.blurb}</span>
                    </button>
                  );
                })}
              </div>
            </s-stack>
          </s-section>

          <s-section accessibilityLabel="Your shoppers will search by">
            <h2 className="ff-sec-title">Your shoppers will search by</h2>
            <s-stack gap="base">
              <span className="ff-chips">
                {preset.fields.map((f, i) => (
                  <span key={f.label} className="ff-chips">
                    {i > 0 && (
                      <span aria-hidden="true" className="ff-chip-sep">
                        ›
                      </span>
                    )}
                    <s-badge>{f.label}</s-badge>
                  </span>
                ))}
              </span>
              <s-paragraph color="subdued">
                {choice === "custom"
                  ? "For example, a printer shop could use Brand › Series › Model, and an appliance shop Brand › Type › Model number."
                  : `Your store will show “Search Widget” with ${preset.fields.length} dropdowns.`}
              </s-paragraph>
              <s-stack direction="inline" justifyContent="end">
                {changing ? (
                  <s-button
                    variant="primary"
                    commandFor={REPLACE_MODAL}
                    disabled={busy}
                  >
                    Replace my setup
                  </s-button>
                ) : (
                  <s-button
                    variant="primary"
                    loading={busy}
                    onClick={() => submit(false)}
                  >
                    Continue
                  </s-button>
                )}
              </s-stack>
            </s-stack>
          </s-section>
        </s-stack>
      </div>

      {changing && counts && (
        <s-modal id={REPLACE_MODAL} heading="Replace your setup?" size="small">
          <s-paragraph>
            {`Your ${plural(counts.fields, "search field")} and ${plural(counts.rows, "filter row")} are deleted, and the ${preset.label} fields are added. Export your filter data first if you want to keep it. This can't be undone.`}
          </s-paragraph>
          <s-button
            slot="primary-action"
            variant="primary"
            tone="critical"
            loading={busy}
            onClick={() => submit(true)}
          >
            Replace my setup
          </s-button>
          <s-button
            slot="secondary-actions"
            commandFor={REPLACE_MODAL}
            command="--hide"
            disabled={busy}
          >
            Cancel
          </s-button>
        </s-modal>
      )}
    </s-page>
  );
}
