// Filter data: browse, search, add, edit, delete and export filter rows; clean up.
// Spec: .claude/specs/fitment-data.md · Prototype: .claude/design/scripts/screens/fitment-data.js
// Rows come from /api/fitment (paged, searched as you type); the counts from this loader.
import { useCallback, useEffect, useRef, useState } from "react";
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
  useSearchParams,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { getSearchConfig } from "../models/search-config.server";
import {
  FitmentRuleError,
  countDuplicates,
  deleteAllRows,
  deleteRows,
  listRowFields,
  removeDuplicates,
  rowCounts,
  filterDataIntentSchema,
  saveRow,
  type RowPage,
} from "../models/fitment-row.server";
import {
  ATTACHMENT_KEY,
  MAX_SELECTED,
  cellDisplay,
  cellText,
  rowSummary,
  type RowField,
  type RowView,
} from "../services/fitment/rows";
import { MAX_ATTACHMENT_LENGTH } from "../services/import/transform";
import { isLockTimeout, relink } from "../services/linking/relink.server";
import { saveBlob } from "../components/import/client";
import styles from "../styles/filter-data.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  // The layout redirects too, but child loaders run in parallel with it.
  if (!(await getSearchConfig(shop.id))) throw redirect("/app/onboarding");
  const [fields, counts] = await Promise.all([
    listRowFields(shop.id),
    rowCounts(shop.id),
  ]);
  return { fields, counts };
};

export type ActionResult =
  | { ok: true; toast?: string; duplicates?: number }
  | { ok: false; error?: string; fieldErrors?: Record<string, string> };

const plural = (n: number, word: string) =>
  `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const form = Object.fromEntries(await request.formData()) as Record<
    string,
    string
  >;
  const parsed = filterDataIntentSchema.safeParse(form);
  if (!parsed.success) {
    return data<ActionResult>(
      { ok: false, error: "That change couldn't be saved." },
      { status: 400 },
    );
  }
  const input = parsed.data;

  try {
    switch (input.intent) {
      case "add":
      case "edit": {
        const result = await saveRow(
          shop.id,
          input.intent === "edit" ? BigInt(input.rowId) : null,
          form,
        );
        if (!result.ok) {
          return data<ActionResult>(
            { ok: false, fieldErrors: result.fieldErrors },
            { status: 400 },
          );
        }
        // Link the row's SKU right away (Product mapping › Add filter row: "saving links it").
        // An edit relinks the old SKU too. A long link check holding the lock isn't waited for:
        // that check (or the next one) links the row.
        const attachments = [
          ...new Set([result.attachment, result.previous ?? result.attachment]),
        ];
        await relink(shop.id, { attachments, lockTimeout: "3s" }).catch(
          (error) => {
            if (!isLockTimeout(error)) {
              console.error("filter-data: linking the saved row failed", {
                shop: session.shop,
                error,
              });
            }
          },
        );
        return data<ActionResult>({
          ok: true,
          toast: input.intent === "add" ? "Row added" : "Row updated",
        });
      }
      case "delete": {
        const n = await deleteRows(shop.id, input.ids);
        return data<ActionResult>({
          ok: true,
          toast:
            input.single && n === 1
              ? "Row deleted"
              : `${plural(n, "row")} deleted`,
        });
      }
      case "delete-all":
        await deleteAllRows(shop.id);
        return data<ActionResult>({
          ok: true,
          toast: "All filter rows deleted",
        });
      case "dedupe-count":
        return data<ActionResult>({
          ok: true,
          duplicates: await countDuplicates(shop.id),
        });
      case "dedupe": {
        const n = await removeDuplicates(shop.id);
        return data<ActionResult>({
          ok: true,
          toast: `${plural(n, "duplicate row")} removed`,
        });
      }
    }
  } catch (error) {
    if (error instanceof FitmentRuleError) {
      return data<ActionResult>(
        { ok: false, error: error.message },
        { status: 409 },
      );
    }
    console.error("filter-data: action failed", {
      shop: session.shop,
      intent: input.intent,
      error,
    });
    return data<ActionResult>(
      { ok: false, error: "That change couldn't be saved. Try again." },
      { status: 500 },
    );
  }
};

const ROW_MODAL = "row-modal";
const EXPORT_MODAL = "export-modal";
const CONFIRM_MODAL = "confirm-modal";
const SEARCH_DELAY_MS = 300;
const LOAD_FAILED = "Rows couldn't be loaded. Try again.";

type Confirm =
  | { kind: "row"; row: RowView }
  | { kind: "selected"; ids: string[] }
  | { kind: "all"; total: number }
  | { kind: "dedupe"; n: number };

type ExportScope = "all" | "selected" | "unmatched";

/** Title, body and red button of the shared delete confirmation (spec table). */
function confirmText(c: Confirm, fields: RowField[]) {
  switch (c.kind) {
    case "row":
      return {
        title: "Delete this row?",
        body: `${rowSummary(fields, c.row)} will be removed from your filter data. This can't be undone.`,
        cta: "Delete row",
      };
    case "selected": {
      const n = c.ids.length;
      return {
        title: `Delete ${plural(n, "row")}?`,
        body: `The selected row${n === 1 ? "" : "s"} will be removed from your filter data. This can't be undone.`,
        cta: `Delete ${plural(n, "row")}`,
      };
    }
    case "all":
      return {
        title: "Delete all filter rows?",
        body: `All ${plural(c.total, "row")} will be removed. Your search will show no results until you import data again. Products in Shopify are not changed. This can't be undone.`,
        cta: "Delete all rows",
      };
    case "dedupe":
      return c.n === 0
        ? {
            title: "No duplicate rows",
            body: "Every row is unique, so there is nothing to remove.",
            cta: null,
          }
        : {
            title: `Remove ${plural(c.n, "duplicate row")}?`,
            body: "Rows that are the same as another row apart from upper/lower case and spaces will be removed. One of each is kept. This can't be undone.",
            cta: `Remove ${plural(c.n, "row")}`,
          };
  }
}

export default function FilterDataPage() {
  const { fields, counts } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const openImport = () => navigate("/app/search-setup?import=1");

  // ---- rows: searched as you type, paged on the server
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rowsVersion, setRowsVersion] = useState(0);
  const [rows, setRows] = useState<RowPage | null>(null);
  const [rowsLoading, setRowsLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    const abort = new AbortController();
    setRowsLoading(true);
    const params = new URLSearchParams({ q: query, page: String(page) });
    fetch(`/api/fitment?${params}`, { signal: abort.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as RowPage & {
          error?: string;
        };
        setRowsLoading(false);
        if (res.ok) setRows(body);
        // A search that took too long comes back with its own message.
        else shopify.toast.show(body.error ?? LOAD_FAILED, { isError: true });
      })
      .catch(() => {
        if (abort.signal.aborted) return;
        setRowsLoading(false);
        shopify.toast.show(LOAD_FAILED, { isError: true });
      });
    return () => abort.abort();
  }, [query, page, rowsVersion, shopify]);
  const reloadRows = useCallback(() => setRowsVersion((v) => v + 1), []);

  // ---- selection (kept across pages and searches)
  const [selected, setSelected] = useState<string[]>([]);
  const [exportScope, setExportScope] = useState<ExportScope | null>(null);
  const toggle = (id: string, on: boolean) => {
    if (on && selected.length >= MAX_SELECTED) {
      shopify.toast.show(
        `You can select up to ${MAX_SELECTED.toLocaleString("en-US")} rows at a time.`,
        { isError: true },
      );
      return;
    }
    setSelected((s) =>
      on ? [...s.filter((x) => x !== id), id] : s.filter((x) => x !== id),
    );
    setExportScope(null);
  };
  const clearSelection = () => {
    setSelected([]);
    setExportScope(null);
  };

  // ---- add / edit row modal
  const rowFetcher = useFetcher<ActionResult>();
  const [editing, setEditing] = useState<RowView | null>(null);
  const [rowFormKey, setRowFormKey] = useState(0);
  const inputs = useRef<Record<string, { value: string } | null>>({});
  // Field errors of the last save; cleared when the modal opens again.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // SKU for a new row, when Product mapping › Add filter row sent us here (?add=SKU).
  const [prefillSku, setPrefillSku] = useState("");
  const openRowModal = (row: RowView | null, sku = "") => {
    setEditing(row);
    setPrefillSku(sku);
    setFieldErrors({});
    setRowFormKey((k) => k + 1);
    void shopify.modal.show(ROW_MODAL);
  };
  const [searchParams, setSearchParams] = useSearchParams();
  const addSku = searchParams.get("add");
  useEffect(() => {
    if (addSku === null) return;
    openRowModal(null, addSku.slice(0, MAX_ATTACHMENT_LENGTH));
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("add");
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
    // Once per ?add= visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSku]);
  const saveRowForm = () => {
    const form: Record<string, string> = editing
      ? { intent: "edit", rowId: editing.id }
      : { intent: "add" };
    for (const [key, el] of Object.entries(inputs.current)) {
      if (el) form[key] = String(el.value ?? "");
    }
    rowFetcher.submit(form, { method: "post" });
  };

  // ---- confirmations (deletes, duplicates)
  const confirmFetcher = useFetcher<ActionResult>();
  const countFetcher = useFetcher<ActionResult>();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const ask = (c: Confirm) => {
    setConfirm(c);
    void shopify.modal.show(CONFIRM_MODAL);
  };
  const runConfirmed = () => {
    if (!confirm) return;
    const body: Record<string, string> =
      confirm.kind === "row"
        ? {
            intent: "delete",
            ids: JSON.stringify([confirm.row.id]),
            single: "1",
          }
        : confirm.kind === "selected"
          ? { intent: "delete", ids: JSON.stringify(confirm.ids) }
          : confirm.kind === "all"
            ? { intent: "delete-all" }
            : { intent: "dedupe" };
    confirmFetcher.submit(body, { method: "post" });
  };

  // Results: toast, close the modal only after success (async confirm), refresh the rows.
  useEffect(() => {
    const r = rowFetcher.data;
    if (rowFetcher.state !== "idle" || !r) return;
    setFieldErrors(r.ok ? {} : (r.fieldErrors ?? {}));
    if (r.ok) {
      void shopify.modal.hide(ROW_MODAL);
      if (r.toast) shopify.toast.show(r.toast);
      reloadRows();
    } else if (r.error) {
      shopify.toast.show(r.error, { isError: true });
    }
  }, [rowFetcher.state, rowFetcher.data, shopify, reloadRows]);
  useEffect(() => {
    const r = confirmFetcher.data;
    if (confirmFetcher.state !== "idle" || !r) return;
    if (r.ok) {
      void shopify.modal.hide(CONFIRM_MODAL);
      if (r.toast) shopify.toast.show(r.toast);
      setSelected((s) => {
        if (!confirm || confirm.kind === "all" || confirm.kind === "dedupe") {
          return confirm?.kind === "all" ? [] : s;
        }
        const gone = confirm.kind === "row" ? [confirm.row.id] : confirm.ids;
        return s.filter((id) => !gone.includes(id));
      });
      reloadRows();
    } else if (r.error) {
      shopify.toast.show(r.error, { isError: true });
    }
    // Only when a response arrives; `confirm` is the action it answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmFetcher.state, confirmFetcher.data, shopify, reloadRows]);
  useEffect(() => {
    const r = countFetcher.data;
    if (countFetcher.state !== "idle" || !r) return;
    if (r.ok && r.duplicates !== undefined)
      ask({ kind: "dedupe", n: r.duplicates });
    else if (!r.ok && r.error) shopify.toast.show(r.error, { isError: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countFetcher.state, countFetcher.data]);

  // ---- export
  const [exporting, setExporting] = useState(false);
  const [exportFormKey, setExportFormKey] = useState(0);
  const scope: ExportScope =
    exportScope === "selected" && !selected.length
      ? "all"
      : (exportScope ?? (selected.length ? "selected" : "all"));
  const openExport = (preset: ExportScope | null) => {
    setExportScope(preset);
    setExportFormKey((k) => k + 1);
    void shopify.modal.show(EXPORT_MODAL);
  };
  const runExport = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/fitment/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          scope === "selected" ? { scope, ids: selected } : { scope },
        ),
      });
      if (!res.ok) throw new Error(String(res.status));
      const name =
        res.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] ?? "filter-data.csv";
      const n = Number(res.headers.get("X-Row-Count") ?? 0);
      saveBlob(await res.blob(), name);
      void shopify.modal.hide(EXPORT_MODAL);
      shopify.toast.show(`Exported ${plural(n, "row")}`);
    } catch {
      shopify.toast.show("The export failed. Try again.", { isError: true });
    } finally {
      setExporting(false);
    }
  };

  const confirmCopy = confirm ? confirmText(confirm, fields) : null;
  const searchPlaceholder = `Search ${fields.map((f) => f.label.toLowerCase()).join(", ")} or SKU`;
  const footer =
    rows?.matching !== null && rows?.matching !== undefined
      ? `${rows.matching.toLocaleString("en-US")} of ${plural(counts.total, "row")} match`
      : plural(counts.total, "row");

  return (
    <s-page heading="Filter data" inlineSize="base">
      <s-button
        slot="primary-action"
        variant="primary"
        icon="upload"
        onClick={openImport}
      >
        Import CSV
      </s-button>
      {/* Title-bar buttons open modals through the Modal API (commandFor is documented for menus only). */}
      <s-button slot="secondary-actions" onClick={() => openExport(null)}>
        Export
      </s-button>

      <s-stack gap="base">
        {counts.unlinkedSkus > 0 && (
          <s-banner
            tone="warning"
            heading={
              counts.unlinkedSkus === 1
                ? "1 SKU isn't linked to a product"
                : `${counts.unlinkedSkus.toLocaleString("en-US")} SKUs aren't linked to a product`
            }
          >
            <s-grid
              gridTemplateColumns="1fr auto"
              gap="base"
              alignItems="center"
            >
              <s-text>
                {counts.unlinkedRows === 1
                  ? "Shoppers won't see this row in search results until it's linked to a product."
                  : "Shoppers won't see these rows in search results until they're linked to a product."}
              </s-text>
              <s-button onClick={() => navigate("/app/product-mapping")}>
                Link products
              </s-button>
            </s-grid>
          </s-banner>
        )}

        <s-section padding="none" accessibilityLabel="Filter rows">
          <s-box padding="base">
            <s-grid
              gridTemplateColumns="1fr auto"
              gap="base"
              alignItems="center"
            >
              <s-search-field
                label="Search rows"
                labelAccessibilityVisibility="exclusive"
                placeholder={searchPlaceholder}
                value={search}
                onInput={(e) => setSearch(String(e.currentTarget.value ?? ""))}
              />
              <s-button icon="plus" onClick={() => openRowModal(null)}>
                Add row
              </s-button>
            </s-grid>
          </s-box>

          {selected.length > 0 && (
            <div className="ff-bulk">
              <s-text type="strong">
                {selected.length.toLocaleString("en-US")} selected
              </s-text>
              <s-button-group>
                <s-button slot="secondary-actions" onClick={clearSelection}>
                  Clear selection
                </s-button>
                <s-button
                  slot="secondary-actions"
                  icon="export"
                  onClick={() => openExport("selected")}
                >
                  Export selected
                </s-button>
                <s-button
                  slot="secondary-actions"
                  tone="critical"
                  icon="delete"
                  onClick={() => ask({ kind: "selected", ids: selected })}
                >
                  Delete selected
                </s-button>
              </s-button-group>
            </div>
          )}

          {counts.total === 0 ? (
            <s-box padding="large">
              <s-stack gap="base" alignItems="center">
                <s-heading>No rows yet</s-heading>
                <s-paragraph color="subdued">
                  Import a CSV or add rows by hand.
                </s-paragraph>
                <s-button variant="primary" onClick={openImport}>
                  Import CSV
                </s-button>
              </s-stack>
            </s-box>
          ) : (
            <>
              <s-table
                paginate
                loading={rowsLoading}
                hasPreviousPage={page > 1}
                hasNextPage={!!rows?.hasNextPage}
                onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
                onNextPage={() => setPage((p) => p + 1)}
              >
                <s-table-header-row>
                  <s-table-header listSlot="inline">Select</s-table-header>
                  {fields.map((f, i) => (
                    <s-table-header
                      key={f.id}
                      listSlot={i === 0 ? "primary" : "labeled"}
                    >
                      {f.label}
                    </s-table-header>
                  ))}
                  <s-table-header>SKU</s-table-header>
                  <s-table-header>Product</s-table-header>
                  <s-table-header>Actions</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {(rows?.rows ?? []).map((r) => (
                    <s-table-row key={r.id}>
                      <s-table-cell>
                        <s-checkbox
                          accessibilityLabel={`Select ${r.attachment}`}
                          checked={selected.includes(r.id)}
                          onChange={(e) =>
                            toggle(r.id, e.currentTarget.checked)
                          }
                        />
                      </s-table-cell>
                      {fields.map((f, i) => (
                        <s-table-cell key={f.id}>
                          {i === 0 ? (
                            <s-text type="strong">{cellDisplay(f, r)}</s-text>
                          ) : (
                            cellDisplay(f, r)
                          )}
                        </s-table-cell>
                      ))}
                      <s-table-cell>{r.attachment}</s-table-cell>
                      <s-table-cell>
                        {r.linked ? (
                          <s-badge tone="success">Mapped</s-badge>
                        ) : (
                          <s-badge tone="warning">Unmatched</s-badge>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        <s-stack direction="inline" gap="small-300">
                          <s-button
                            variant="tertiary"
                            icon="edit"
                            accessibilityLabel={`Edit ${r.attachment}`}
                            onClick={() => openRowModal(r)}
                          />
                          <s-button
                            variant="tertiary"
                            icon="delete"
                            tone="critical"
                            accessibilityLabel={`Delete ${r.attachment}`}
                            onClick={() => ask({ kind: "row", row: r })}
                          />
                        </s-stack>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
              <s-box padding="base">
                <s-text color="subdued">{footer}</s-text>
              </s-box>
            </>
          )}
        </s-section>

        <s-section accessibilityLabel="Clean up">
          <s-stack direction="inline" gap="small" alignItems="center">
            <span className="ff-cu-ico">
              <s-icon type="eraser" size="small" />
            </span>
            <h2 className="ff-sec-title">Clean up</h2>
          </s-stack>
          <s-box paddingBlockStart="base">
            <s-grid
              gridTemplateColumns="1fr auto"
              gap="base"
              alignItems="center"
            >
              <s-stack gap="none">
                <s-text type="strong">Remove duplicate rows</s-text>
                <s-text color="subdued">
                  Deletes rows that are the same apart from upper/lower case and
                  spaces, keeping one of each.
                </s-text>
              </s-stack>
              <s-stack alignItems="end">
                <s-button
                  loading={countFetcher.state !== "idle"}
                  onClick={() =>
                    countFetcher.submit(
                      { intent: "dedupe-count" },
                      { method: "post" },
                    )
                  }
                >
                  Remove duplicates
                </s-button>
              </s-stack>
              <s-stack gap="none">
                <s-text type="strong">Delete all rows</s-text>
                <s-text color="subdued">
                  Removes every filter row. Products in Shopify are not changed.
                </s-text>
              </s-stack>
              <s-stack alignItems="end">
                <s-button
                  tone="critical"
                  disabled={counts.total === 0}
                  onClick={() => ask({ kind: "all", total: counts.total })}
                >
                  Delete all rows
                </s-button>
              </s-stack>
            </s-grid>
          </s-box>
        </s-section>
      </s-stack>

      <s-modal id={EXPORT_MODAL} heading="Export filter data">
        <s-stack gap="base">
          <s-paragraph color="subdued">
            The file uses the same columns as the import, so you can edit it and
            import it again.
          </s-paragraph>
          <s-choice-list
            key={exportFormKey}
            label="What to export"
            onChange={(e) =>
              setExportScope(
                ((e.currentTarget.values ?? [])[0] as ExportScope) ?? "all",
              )
            }
          >
            <s-choice value="all" defaultSelected={scope === "all"}>
              All rows ({counts.total.toLocaleString("en-US")})
            </s-choice>
            <s-choice
              value="selected"
              defaultSelected={scope === "selected"}
              disabled={selected.length === 0}
            >
              Selected rows ({selected.length.toLocaleString("en-US")})
              {selected.length === 0 && (
                <s-text slot="details">Select rows in the table first.</s-text>
              )}
            </s-choice>
            <s-choice value="unmatched" defaultSelected={scope === "unmatched"}>
              Only rows with unlinked SKUs (
              {counts.unlinkedRows.toLocaleString("en-US")})
            </s-choice>
          </s-choice-list>
          <s-text color="subdued">Format: CSV (UTF-8)</s-text>
        </s-stack>
        <s-button
          slot="primary-action"
          variant="primary"
          loading={exporting}
          onClick={() => void runExport()}
        >
          Export CSV
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor={EXPORT_MODAL}
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>

      <s-modal id={ROW_MODAL} heading={editing ? "Edit row" : "Add row"}>
        <div className="ff-add-grid" key={rowFormKey}>
          {fields.map((f) => (
            <s-text-field
              key={f.id}
              label={f.label}
              ref={(el: unknown) => {
                inputs.current[f.id] = el as { value: string } | null;
              }}
              defaultValue={editing ? cellText(f, editing) : ""}
              placeholder={
                f.type === "year_range" ? "e.g. 2015-2020 or 2019-" : ""
              }
              required={f.required}
              error={fieldErrors[f.id]}
            />
          ))}
          <s-text-field
            label="SKU"
            ref={(el: unknown) => {
              inputs.current[ATTACHMENT_KEY] = el as { value: string } | null;
            }}
            defaultValue={editing?.attachment ?? prefillSku}
            required
            error={fieldErrors[ATTACHMENT_KEY]}
          />
        </div>
        {editing?.linked && (
          <s-box paddingBlockStart="base">
            <s-text color="subdued">
              Changing the SKU unlinks this row from its product.
            </s-text>
          </s-box>
        )}
        <s-button
          slot="primary-action"
          variant="primary"
          loading={rowFetcher.state !== "idle"}
          onClick={saveRowForm}
        >
          {editing ? "Save changes" : "Add row"}
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor={ROW_MODAL}
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>

      <s-modal
        id={CONFIRM_MODAL}
        heading={confirmCopy?.title ?? "Delete?"}
        size="small"
      >
        <s-paragraph>{confirmCopy?.body ?? ""}</s-paragraph>
        {confirmCopy?.cta ? (
          <>
            <s-button
              slot="primary-action"
              variant="primary"
              tone="critical"
              loading={confirmFetcher.state !== "idle"}
              onClick={runConfirmed}
            >
              {confirmCopy.cta}
            </s-button>
            <s-button
              slot="secondary-actions"
              commandFor={CONFIRM_MODAL}
              command="--hide"
            >
              Cancel
            </s-button>
          </>
        ) : (
          <s-button
            slot="primary-action"
            commandFor={CONFIRM_MODAL}
            command="--hide"
          >
            Close
          </s-button>
        )}
      </s-modal>
    </s-page>
  );
}
