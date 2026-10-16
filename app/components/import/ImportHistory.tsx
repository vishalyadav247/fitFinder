// Search setup's import cards (specs/search-setup.md): Import (starts the Import CSV card) and
// Import history, the files the plan keeps (backups), newest first, each downloadable. Without the
// plan's Import backups, the history shows locked (LockedSection).
import { useAppBridge } from "@shopify/app-bridge-react";
import { download } from "./client";
import { SectionTitle } from "../SectionTitle";
import { LockedSection } from "../LockedSection";

export interface HistoryItem {
  id: string;
  fileName: string;
  finishedAt: string | null;
  mode: "upsert" | "replace" | "delete";
  rows: number | null;
  hasFile: boolean;
}

const HISTORY_MODE: Record<HistoryItem["mode"], string> = {
  upsert: "Add and update",
  replace: "Replace all",
  delete: "Delete listed rows",
};

function when(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "last 5 files" / "last file": the plan's backup count. */
export const keptText = (n: number) =>
  n === 1 ? "last file" : `last ${n} files`;

/** The card that starts an import (above Import history). */
export function ImportStart({
  imported,
  onImport,
}: {
  /** The shop has imported a file before. */
  imported: boolean;
  onImport: () => void;
}) {
  return (
    <s-section accessibilityLabel="Import filter data">
      <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
        <s-stack gap="small-100">
          <SectionTitle icon="upload">Import filter data</SectionTitle>
          <s-text color="subdued">
            Upload a CSV with your SKUs and what they fit. You match its columns
            to your search fields next.
          </s-text>
        </s-stack>
        <s-button variant="primary" icon="upload" onClick={onImport}>
          {imported ? "Import new file" : "Import CSV"}
        </s-button>
      </s-grid>
    </s-section>
  );
}

export function ImportHistory({
  items,
  kept,
  lockedPlan,
}: {
  items: HistoryItem[];
  /** Imported files the plan keeps as backups; 0 = no Import backups (shown locked). */
  kept: number;
  /** Without Import backups: the plan that adds it ("" = none yet). */
  lockedPlan: string | null;
}) {
  const shopify = useAppBridge();
  // Nothing imported yet: the Import card above says what to do.
  if (!items.length) return null;
  const locked = kept === 0;

  const table = (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">File</s-table-header>
        <s-table-header>Imported</s-table-header>
        <s-table-header>Import type</s-table-header>
        <s-table-header format="numeric">Rows</s-table-header>
        <s-table-header>Backup</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {items.map((h, i) => (
          <s-table-row key={h.id}>
            <s-table-cell>
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text type="strong">{h.fileName}</s-text>
                {i === 0 && <s-badge tone="success">Current</s-badge>}
              </s-stack>
            </s-table-cell>
            <s-table-cell>{when(h.finishedAt)}</s-table-cell>
            <s-table-cell>{HISTORY_MODE[h.mode]}</s-table-cell>
            <s-table-cell>
              {h.rows === null ? "" : h.rows.toLocaleString("en")}
            </s-table-cell>
            <s-table-cell>
              <s-button
                variant="tertiary"
                icon="download"
                accessibilityLabel={`Download ${h.fileName}`}
                disabled={locked || !h.hasFile}
                onClick={async () => {
                  const ok = await download(
                    `/api/imports/${h.id}/file`,
                    h.fileName,
                  );
                  if (ok) shopify.toast.show(`Downloaded ${h.fileName}`);
                  else
                    shopify.toast.show("The file couldn't be downloaded.", {
                      isError: true,
                    });
                }}
              >
                Download
              </s-button>
            </s-table-cell>
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );

  return (
    <s-section padding="none" accessibilityLabel="Import history">
      <s-box padding="base">
        <s-stack gap="small-100">
          <SectionTitle icon="clock">Import history</SectionTitle>
          <s-text color="subdued">
            {locked
              ? "Download the files you imported any time."
              : `We keep your ${keptText(kept)}, so you can download a backup any time. A new import removes the oldest one.`}
          </s-text>
        </s-stack>
      </s-box>
      {locked ? (
        <LockedSection
          plan={lockedPlan ?? ""}
          feature="Import backups"
          text="Keep your recent imported files and download them any time."
        >
          {table}
        </LockedSection>
      ) : (
        table
      )}
    </s-section>
  );
}
