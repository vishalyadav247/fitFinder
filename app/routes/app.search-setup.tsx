// Search setup: the fields shoppers pick, Import history and the Import CSV card. Field edits
// (name, placeholder, type, required) collect in a draft behind the App Bridge save bar and are
// saved together; Add field, the move arrows and Delete are immediate actions.
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
  useSearchParams,
} from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { z } from "zod";
import type { SearchField } from "@prisma/client";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { getSearchConfig } from "../models/search-config.server";
import {
  FieldRuleError,
  FieldTimeoutError,
  applyFieldIntent,
  applyFieldSave,
  fieldIntentSchema,
  MAX_FIELDS,
  type SaveStep,
  listFields,
} from "../models/search-field.server";
import { STORE_TYPES } from "../services/store-types";
import {
  ADD_FIELD_HINT,
  LABEL_MAX,
  NEW_FIELD_LABEL,
  PLACEHOLDER_MAX,
  placeholderFor,
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
import { SectionTitle } from "../components/SectionTitle";
import { PageHeader } from "../components/PageHeader";

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

const fieldEditSchema = z.object({
  label: z.string().max(LABEL_MAX).optional(),
  placeholder: z.string().max(PLACEHOLDER_MAX).optional(),
  type: z.enum(["list", "year_range"]).optional(),
  required: z.boolean().optional(),
});
type FieldEdit = z.infer<typeof fieldEditSchema>;
/** A field added in the draft, saved on the next Save. */
type NewField = {
  key: string;
  label: string;
  placeholder: string;
  type: "list" | "year_range";
  required: boolean;
};
const NEW_KEY = /^new:\d{1,4}$/;

/**
 * The save bar's Save: edits to saved fields, fields added in the draft (key "new:n") and the
 * order of all of them. Applied in one transaction (applyFieldSave).
 */
const saveSchema = z.object({
  intent: z.literal("save"),
  changes: z
    .string()
    .max(40_000)
    .transform((json, ctx) => {
      try {
        return JSON.parse(json) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "bad json" });
        return z.NEVER;
      }
    })
    .pipe(
      z.object({
        edits: z
          .array(fieldEditSchema.extend({ fieldId: z.string().min(1) }))
          .max(MAX_FIELDS),
        added: z
          .array(fieldEditSchema.extend({ key: z.string().regex(NEW_KEY) }))
          .max(MAX_FIELDS),
        order: z
          .array(z.string().min(1))
          .max(MAX_FIELDS * 2)
          .optional(),
      }),
    ),
});

const TOASTS: Partial<Record<string, string>> = {
  delete: "Field deleted",
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);

  const form = Object.fromEntries(await request.formData());
  if (form.intent === "save") return saveFields(shop.id, session.shop, form);
  const parsed = fieldIntentSchema.safeParse(form);
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

/** Applies the save bar's edits field by field; stops at the first one that's refused. */
async function saveFields(shopId: string, shopDomain: string, form: unknown) {
  const parsed = saveSchema.safeParse(form);
  if (!parsed.success) {
    return data<ActionResult>(
      { ok: false, error: "Your changes couldn't be saved." },
      { status: 400 },
    );
  }
  // New fields first, then names, placeholders and Required, then type changes to Dropdown before
  // those to Year range (so the one Year range can move between fields in a single save), then
  // the order. All in one transaction: a refused step leaves nothing changed.
  const { edits, added, order } = parsed.data.changes;
  const all = [
    ...edits,
    ...added.map(({ key, ...edit }) => ({ fieldId: key, ...edit })),
  ];
  const steps: SaveStep[] = added.map(({ key }) => ({ intent: "add", key }));
  for (const { fieldId, label, placeholder, required } of all) {
    if (label !== undefined) {
      steps.push({ intent: "label", fieldId, value: label });
    }
    if (placeholder !== undefined) {
      steps.push({ intent: "placeholder", fieldId, value: placeholder });
    }
    if (required !== undefined) {
      steps.push({ intent: "required", fieldId, value: required });
    }
  }
  for (const to of ["list", "year_range"] as const) {
    for (const { fieldId, type } of all) {
      if (type === to) steps.push({ intent: "type", fieldId, value: type });
    }
  }
  if (order) steps.push({ intent: "order", fieldIds: order });
  try {
    await applyFieldSave(shopId, steps);
  } catch (error) {
    // A refused or timed-out save changed nothing (one transaction): say why.
    if (error instanceof FieldRuleError || error instanceof FieldTimeoutError) {
      return data<ActionResult>(
        { ok: false, error: error.message },
        { status: 409 },
      );
    }
    console.error("search-setup: saving fields failed", {
      shop: shopDomain,
      error,
    });
    return data<ActionResult>(
      { ok: false, error: "Your changes couldn't be saved. Try again." },
      { status: 500 },
    );
  }
  return data<ActionResult>({
    ok: true,
    toast: added.length
      ? "Fields saved. Map a column to the new field on your next import."
      : "Fields saved",
  });
}

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
  // Filter data › Import CSV links here with ?import=1 to open the card.
  const [searchParams, setSearchParams] = useSearchParams();
  const [importing, setImporting] = useState(
    active !== null || searchParams.get("import") === "1",
  );
  // Drop the flag once used, so a reload after closing the card doesn't reopen it.
  useEffect(() => {
    if (searchParams.get("import") !== "1") return;
    setSearchParams(
      (p) => {
        p.delete("import");
        return p;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);
  const closeImport = (toast?: string) => {
    setImporting(false);
    if (toast) shopify.toast.show(toast);
    revalidator.revalidate();
  };
  const deleteFetcher = useFetcher<typeof action>();
  const [deleting, setDeleting] = useState<Field | null>(null);
  const shopify = useAppBridge();
  useResultToast(deleteFetcher.data);

  // Async confirm (s-modal guidance): keep the modal open while deleting, close it only after
  // success; on failure it stays open and the error toast shows.
  useEffect(() => {
    if (deleteFetcher.data?.ok) shopify.modal.hide(DELETE_MODAL);
  }, [deleteFetcher.data, shopify]);

  // ---- the draft (save bar): edits to saved fields by id, fields added here ("new:n") and the
  // order of all of them (null = as saved, new ones at the end)
  const [edits, setEdits] = useState<Record<string, FieldEdit>>({});
  const [added, setAdded] = useState<NewField[]>([]);
  const [order, setOrder] = useState<string[] | null>(null);
  const nextKey = useRef(1);
  const saveFetcher = useFetcher<typeof action>();
  useResultToast(saveFetcher.data);
  const saving = saveFetcher.state !== "idle";
  const shown = (f: Field) => ({
    label: f.label,
    placeholder: placeholderFor(f),
    type: f.type,
    required: f.required,
  });
  // Only what differs from the saved field; an emptied name keeps the saved one (not sent).
  const pending = fields.flatMap((f) => {
    const edit = edits[f.id];
    if (!edit) return [];
    const now = shown(f);
    const diff: FieldEdit = {};
    if (edit.label !== undefined) {
      const label = edit.label.trim();
      if (label && label !== now.label) diff.label = label;
    }
    if (
      edit.placeholder !== undefined &&
      edit.placeholder.trim() !== now.placeholder
    ) {
      diff.placeholder = edit.placeholder.trim();
    }
    if (edit.type !== undefined && edit.type !== now.type)
      diff.type = edit.type;
    if (edit.required !== undefined && edit.required !== now.required) {
      diff.required = edit.required;
    }
    return Object.keys(diff).length ? [{ fieldId: f.id, ...diff }] : [];
  });
  // An emptied name counts as a change too (the save bar shows); Save puts the saved name back.
  const emptiedName = fields.some(
    (f) => edits[f.id]?.label !== undefined && !edits[f.id]!.label!.trim(),
  );
  const baseIds = [...fields.map((f) => f.id), ...added.map((a) => a.key)];
  const ids = order
    ? [
        ...order.filter((id) => baseIds.includes(id)),
        ...baseIds.filter((id) => !order.includes(id)),
      ]
    : baseIds;
  const orderChanged = ids.join() !== baseIds.join();
  const dirty =
    pending.length > 0 || emptiedName || added.length > 0 || orderChanged;
  const editField = (fieldId: string, patch: FieldEdit) => {
    if (fieldId.startsWith("new:")) {
      setAdded((cur) =>
        cur.map((a) => (a.key === fieldId ? { ...a, ...patch } : a)),
      );
    } else {
      setEdits((cur) => ({
        ...cur,
        [fieldId]: { ...cur[fieldId], ...patch },
      }));
    }
  };
  const addField = () => {
    const key = "new:" + nextKey.current++;
    setAdded((cur) => [
      ...cur,
      {
        key,
        label: NEW_FIELD_LABEL,
        placeholder: "",
        type: "list",
        required: false,
      },
    ]);
  };
  const removeNew = (key: string) =>
    setAdded((cur) => cur.filter((a) => a.key !== key));
  const moveField = (id: string, dir: -1 | 1) => {
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };
  const rows: Row[] = ids.map((id) => {
    const isNew = id.startsWith("new:");
    const base = isNew
      ? added.find((a) => a.key === id)!
      : fields.find((f) => f.id === id)!;
    const edit: FieldEdit = isNew ? {} : (edits[id] ?? {});
    return {
      id,
      isNew,
      field: base,
      label: edit.label ?? base.label,
      placeholder: edit.placeholder ?? placeholderFor(base),
      type: edit.type ?? base.type,
      required: edit.required ?? base.required,
    };
  });
  // The edits this Save sent: only those leave the draft afterwards, so anything typed while the
  // save runs stays.
  const sent = useRef<Record<string, FieldEdit> | null>(null);
  const saveAll = () => {
    sent.current = edits;
    const changes = {
      edits: pending,
      added: added.map((a) => ({
        key: a.key,
        label: a.label.trim() || NEW_FIELD_LABEL,
        placeholder: a.placeholder.trim(),
        type: a.type,
        required: a.required,
      })),
      ...(orderChanged ? { order: ids } : {}),
    };
    saveFetcher.submit(
      { intent: "save", changes: JSON.stringify(changes) },
      { method: "post" },
    );
  };
  const discard = () => {
    setEdits({});
    setAdded([]);
    setOrder(null);
  };
  useEffect(() => {
    if (saveFetcher.state !== "idle" || !saveFetcher.data || !sent.current) {
      return;
    }
    const done = sent.current;
    sent.current = null;
    // Refused: nothing was saved (one transaction), so the draft stays as it is.
    if (!saveFetcher.data.ok) return;
    // New fields and the order are saved (they can't change while a save runs).
    setAdded([]);
    setOrder(null);
    setEdits((cur) => {
      const next: Record<string, FieldEdit> = {};
      for (const [fieldId, edit] of Object.entries(cur)) {
        const kept: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(edit)) {
          const was = done[fieldId]?.[key as keyof FieldEdit];
          if (value !== was) kept[key] = value;
        }
        if (Object.keys(kept).length) next[fieldId] = kept as FieldEdit;
      }
      return next;
    });
  }, [saveFetcher.state, saveFetcher.data]);

  /** Leaving the page from inside it: ask first while there are unsaved changes. */
  const leave = async (go: () => void) => {
    // Resolves when the merchant confirms (or no save bar is open); staying never resolves.
    if (dirty) await shopify.saveBar.leaveConfirmation?.();
    go();
  };

  const deleteField = () => {
    if (!deleting) return;
    deleteFetcher.submit(
      { intent: "delete", fieldId: deleting.id },
      { method: "post" },
    );
  };

  return (
    <s-page inlineSize="base">
      {/* App Bridge save bar: the primary button is Save, the other one Discard. */}
      <SaveBar id="search-setup-save-bar" open={dirty} discardConfirmation>
        <button
          variant="primary"
          loading={saving ? "" : undefined}
          onClick={saveAll}
        >
          Save
        </button>
        <button disabled={saving} onClick={discard}>
          Discard
        </button>
      </SaveBar>
      <PageHeader title="Search setup">
        <s-button
          icon="store"
          onClick={() => void leave(() => navigate("/app/onboarding"))}
        >
          Change store type
        </s-button>
      </PageHeader>

      <s-stack gap="base">
        <s-section padding="none" accessibilityLabel="Fields shoppers pick">
          <s-box padding="base">
            <s-stack gap="small-100">
              <SectionTitle icon="filter">Fields shoppers pick</SectionTitle>
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
          {rows.map((row, i) => (
            <FieldRow
              key={row.id}
              row={row}
              onEdit={(patch) => editField(row.id, patch)}
              index={i}
              last={i === rows.length - 1}
              saving={saving}
              onMove={(dir) => moveField(row.id, dir)}
              onDelete={() =>
                row.isNew ? removeNew(row.id) : setDeleting(row.field as Field)
              }
            />
          ))}
          <s-box padding="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button icon="plus" disabled={saving} onClick={addField}>
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

type Row = {
  id: string;
  isNew: boolean;
  field: Field | NewField;
  label: string;
  placeholder: string;
  type: "list" | "year_range";
  required: boolean;
};

/**
 * One field line, edited in place. Everything goes to the page's draft (save bar): edits, the
 * move arrows, and removing a field added here. Deleting a saved field asks first (modal).
 */
function FieldRow({
  row,
  onEdit,
  index,
  last,
  saving,
  onMove,
  onDelete,
}: {
  row: Row;
  onEdit: (patch: FieldEdit) => void;
  index: number;
  last: boolean;
  saving: boolean;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const valueOf = (e: Event) =>
    String((e.currentTarget as HTMLInputElement).value ?? "");
  // A new field can't change while it is being saved (it has no id yet).
  const locked = saving && row.isNew;

  return (
    <div className="ff-fgrid ff-frow">
      <span>
        <s-badge tone={row.isNew ? "info" : undefined}>
          {String(index + 1)}
        </s-badge>
      </span>
      <s-text-field
        label={`Field ${index + 1} name`}
        labelAccessibilityVisibility="exclusive"
        value={row.label}
        maxLength={LABEL_MAX}
        disabled={locked}
        onInput={(e) => onEdit({ label: valueOf(e) })}
      />
      <s-text-field
        label={`Placeholder for ${row.label}`}
        labelAccessibilityVisibility="exclusive"
        value={row.placeholder}
        maxLength={PLACEHOLDER_MAX}
        disabled={locked}
        onInput={(e) => onEdit({ placeholder: valueOf(e) })}
      />
      <s-select
        label={`Type of ${row.label}`}
        labelAccessibilityVisibility="exclusive"
        value={row.type}
        disabled={locked}
        onChange={(e) => onEdit({ type: valueOf(e) as "list" | "year_range" })}
      >
        <s-option value="list">Dropdown</s-option>
        <s-option value="year_range">Year range</s-option>
      </s-select>
      <s-checkbox
        label="Required"
        accessibilityLabel={`${row.label} is required`}
        checked={row.required}
        disabled={locked}
        onChange={(e) => onEdit({ required: e.currentTarget.checked })}
      />
      <s-stack direction="inline" gap="small-100">
        <s-button
          variant="tertiary"
          icon="arrow-up"
          accessibilityLabel={`Move ${row.label} up`}
          disabled={index === 0 || saving}
          onClick={() => onMove(-1)}
        />
        <s-button
          variant="tertiary"
          icon="arrow-down"
          accessibilityLabel={`Move ${row.label} down`}
          disabled={last || saving}
          onClick={() => onMove(1)}
        />
        {row.isNew ? (
          <s-button
            variant="tertiary"
            icon="delete"
            tone="critical"
            accessibilityLabel={`Remove ${row.label} (not saved yet)`}
            disabled={saving}
            onClick={onDelete}
          />
        ) : (
          <s-button
            variant="tertiary"
            icon="delete"
            tone="critical"
            accessibilityLabel={`Delete ${row.label}`}
            disabled={saving}
            commandFor={DELETE_MODAL}
            command="--show"
            onClick={onDelete}
          />
        )}
      </s-stack>
    </div>
  );
}
