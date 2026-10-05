// Search setup: the fields shoppers pick, Import history and the Import CSV card.
// Spec: .claude/specs/search-setup.md · Prototype: .claude/design/scripts/screens/search-setup.js
import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  data,
  useFetcher,
  useLoaderData,
  useNavigate,
  useRevalidator,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { SearchField } from "@prisma/client";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { getSearchConfig } from "../models/search-config.server";
import {
  FieldRuleError,
  applyFieldIntent,
  fieldIntentSchema,
  listFields,
} from "../models/search-field.server";
import { STORE_TYPES } from "../services/store-types";
import {
  ADD_FIELD_HINT,
  LABEL_MAX,
  PLACEHOLDER_MAX,
  placeholderFor,
  syncControls,
  type SyncableControl,
} from "../services/search-fields";
import prisma from "../db.server";
import { currentJob, importHistory } from "../services/import/pipeline.server";
import { jobView } from "../services/import/view.server";
import { ImportCard } from "../components/import/ImportCard";
import {
  ImportHistory,
  type HistoryItem,
} from "../components/import/ImportHistory";
import styles from "../styles/search-setup.css?url";
import importStyles from "../styles/import.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: styles },
  { rel: "stylesheet", href: importStyles },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const config = await getSearchConfig(shop.id);
  // The layout redirects too, but child loaders run in parallel with it.
  if (!config) throw redirect("/app/onboarding");
  const [fields, history, current, currentRows] = await Promise.all([
    listFields(shop.id),
    importHistory(shop.id),
    currentJob(shop.id),
    prisma.fitmentRow.count({ where: { shopId: shop.id } }),
  ]);
  const items: HistoryItem[] = history.map((j) => ({
    id: j.id,
    fileName: j.fileName,
    finishedAt: j.finishedAt?.toISOString() ?? null,
    mode: j.mode,
    rows: j.totalRows,
    hasFile: !!j.fileKey,
  }));
  // An import checking or running in the background reopens the card with its progress.
  const active =
    current && (current.status === "previewing" || current.status === "running")
      ? jobView(current, fields)
      : null;
  return {
    storeType: config.storeType,
    fields,
    history: items,
    active,
    currentRows,
  };
};

type ActionResult = { ok: true; toast?: string } | { ok: false; error: string };

const TOASTS: Partial<Record<string, string>> = {
  add: "Field added. Map a column to it on your next import.",
  delete: "Field deleted",
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);

  const parsed = fieldIntentSchema.safeParse(
    Object.fromEntries(await request.formData()),
  );
  if (!parsed.success) {
    return data<ActionResult>(
      { ok: false, error: "That change couldn't be saved." },
      { status: 400 },
    );
  }

  try {
    await applyFieldIntent(shop.id, parsed.data);
  } catch (error) {
    if (error instanceof FieldRuleError) {
      return data<ActionResult>(
        { ok: false, error: error.message },
        { status: 409 },
      );
    }
    console.error("search-setup: field change failed", {
      shop: session.shop,
      intent: parsed.data.intent,
      error,
    });
    return data<ActionResult>(
      { ok: false, error: "That change couldn't be saved. Try again." },
      { status: 500 },
    );
  }
  return data<ActionResult>({ ok: true, toast: TOASTS[parsed.data.intent] });
};

type Field = Pick<
  SearchField,
  "id" | "label" | "placeholder" | "type" | "required"
>;

/** Shows the action's toast (success or error) once per response. */
function useResultToast(result: ActionResult | undefined) {
  const shopify = useAppBridge();
  useEffect(() => {
    if (!result) return;
    if (!result.ok) shopify.toast.show(result.error, { isError: true });
    else if (result.toast) shopify.toast.show(result.toast);
  }, [result, shopify]);
}

const DELETE_MODAL = "delete-field-modal";

export default function SearchSetupPage() {
  const { storeType, fields, history, active, currentRows } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  // The import card replaces Import history while open (spec).
  const [importing, setImporting] = useState(active !== null);
  const closeImport = (toast?: string) => {
    setImporting(false);
    if (toast) shopify.toast.show(toast);
    revalidator.revalidate();
  };
  const pageFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const [deleting, setDeleting] = useState<Field | null>(null);
  const shopify = useAppBridge();
  useResultToast(pageFetcher.data);
  useResultToast(deleteFetcher.data);

  // Async confirm (s-modal guidance): keep the modal open while deleting, close it only after
  // success; on failure it stays open and the error toast shows.
  useEffect(() => {
    if (deleteFetcher.data?.ok) shopify.modal.hide(DELETE_MODAL);
  }, [deleteFetcher.data, shopify]);

  const busy = pageFetcher.state !== "idle";

  const deleteField = () => {
    if (!deleting) return;
    deleteFetcher.submit(
      { intent: "delete", fieldId: deleting.id },
      { method: "post" },
    );
  };

  return (
    <s-page heading="Search setup" inlineSize="base">
      {/* Title-bar buttons are documented with onClick, not href. */}
      <s-button
        slot="secondary-actions"
        icon="store"
        onClick={() => navigate("/app/onboarding")}
      >
        Change store type
      </s-button>

      <s-stack gap="base">
        <s-section padding="none" accessibilityLabel="Fields shoppers pick">
          <s-box padding="base">
            <s-stack gap="small-100">
              <h2 className="ff-sec-title">Fields shoppers pick</h2>
              <s-text color="subdued">
                {STORE_TYPES[storeType].label} · Shoppers pick these in this
                order. When you import a CSV, you choose which column fills each
                field.
              </s-text>
            </s-stack>
          </s-box>
          <div className="ff-fgrid ff-fhead" aria-hidden="true">
            <span>Order</span>
            <span>Field name</span>
            <span>Placeholder</span>
            <span>Type</span>
            <span>Required</span>
            <span>Actions</span>
          </div>
          {fields.map((f, i) => (
            <FieldRow
              key={f.id}
              field={f}
              index={i}
              last={i === fields.length - 1}
              onDelete={() => setDeleting(f)}
            />
          ))}
          <s-box padding="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button
                icon="plus"
                loading={busy && pageFetcher.formData?.get("intent") === "add"}
                onClick={() =>
                  pageFetcher.submit({ intent: "add" }, { method: "post" })
                }
              >
                Add field
              </s-button>
              <s-text color="subdued">{ADD_FIELD_HINT[storeType]}</s-text>
            </s-stack>
          </s-box>
        </s-section>

        {importing ? (
          <ImportCard
            fields={fields.map((f) => ({
              id: f.id,
              label: f.label,
              type: f.type,
              required: f.required,
            }))}
            currentRows={currentRows}
            resume={active}
            onClose={closeImport}
          />
        ) : (
          <ImportHistory items={history} onImport={() => setImporting(true)} />
        )}
      </s-stack>

      <s-modal
        id={DELETE_MODAL}
        heading={
          deleting ? `Delete the ${deleting.label} field?` : "Delete field?"
        }
        size="small"
      >
        <s-paragraph>
          {deleting
            ? `Shoppers will no longer see the ${deleting.label} dropdown, and its values in your filter data won't be used. This can't be undone.`
            : ""}
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={deleteFetcher.state !== "idle"}
          onClick={deleteField}
        >
          Delete field
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor={DELETE_MODAL}
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

/** One field, edited in place; each control saves on change. */
function FieldRow({
  field: f,
  index,
  last,
  onDelete,
}: {
  field: Field;
  index: number;
  last: boolean;
  onDelete: () => void;
}) {
  const fetcher = useFetcher<typeof action>();
  useResultToast(fetcher.data);
  const busy = fetcher.state !== "idle";

  // After every save, show what the server kept (an emptied name keeps the old one, a cleared
  // placeholder shows the default, a refused type change reverts). Props alone can't do this when
  // the saved value didn't change, so write it onto the controls, except the one being edited.
  const controls = useRef<Record<string, SyncableControl | null>>({});
  const bind = (name: string) => (el: unknown) => {
    controls.current[name] = el as SyncableControl | null;
  };
  useEffect(() => {
    if (fetcher.state !== "idle") return;
    const saved: Record<string, string | boolean> = {
      label: f.label,
      placeholder: placeholderFor(f),
      type: f.type,
      required: f.required,
    };
    syncControls(controls.current, saved, document.activeElement);
  }, [fetcher.state, fetcher.data, f]);

  const save = (intent: string, value: string) =>
    fetcher.submit({ intent, fieldId: f.id, value }, { method: "post" });
  const valueOf = (e: Event) =>
    String((e.currentTarget as HTMLInputElement).value ?? "");

  return (
    <div className="ff-fgrid ff-frow">
      <span>
        <s-badge>{String(index + 1)}</s-badge>
      </span>
      <s-text-field
        label={`Field ${index + 1} name`}
        labelAccessibilityVisibility="exclusive"
        ref={bind("label")}
        value={f.label}
        maxLength={LABEL_MAX}
        onChange={(e) => save("label", valueOf(e))}
      />
      <s-text-field
        label={`Placeholder for ${f.label}`}
        labelAccessibilityVisibility="exclusive"
        ref={bind("placeholder")}
        value={placeholderFor(f)}
        maxLength={PLACEHOLDER_MAX}
        onChange={(e) => save("placeholder", valueOf(e))}
      />
      <s-select
        label={`Type of ${f.label}`}
        labelAccessibilityVisibility="exclusive"
        ref={bind("type")}
        value={f.type}
        onChange={(e) => save("type", valueOf(e))}
      >
        <s-option value="list">Dropdown</s-option>
        <s-option value="year_range">Year range</s-option>
      </s-select>
      <s-checkbox
        label="Required"
        accessibilityLabel={`${f.label} is required`}
        ref={bind("required")}
        checked={f.required}
        onChange={(e) => save("required", String(e.currentTarget.checked))}
      />
      <s-stack direction="inline" gap="small-100">
        <s-button
          variant="tertiary"
          icon="arrow-up"
          accessibilityLabel={`Move ${f.label} up`}
          disabled={index === 0 || busy}
          onClick={() => save("move", "up")}
        />
        <s-button
          variant="tertiary"
          icon="arrow-down"
          accessibilityLabel={`Move ${f.label} down`}
          disabled={last || busy}
          onClick={() => save("move", "down")}
        />
        <s-button
          variant="tertiary"
          icon="delete"
          tone="critical"
          accessibilityLabel={`Delete ${f.label}`}
          commandFor={DELETE_MODAL}
          command="--show"
          onClick={onDelete}
        />
      </s-stack>
    </div>
  );
}
