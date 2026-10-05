// Import history (specs/search-setup.md): the last 5 files, newest first, each downloadable.
import { useAppBridge } from "@shopify/app-bridge-react";
import { download } from "./client";

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

export function ImportHistory({
  items,
  onImport,
}: {
  items: HistoryItem[];
  onImport: () => void;
}) {
  const shopify = useAppBridge();
  const has = items.length > 0;

  return (
    <s-section padding="none" accessibilityLabel="Import history">
      <s-box padding="base">
        <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
          <s-stack gap="small-100">
            <h2 className="ff-sec-title">Import history</h2>
            <s-text color="subdued">
              {has
                ? "We keep your last 5 files, so you can download a backup any time. A new import removes the oldest one."
                : "Nothing imported yet. Upload a CSV with your SKUs and what they fit."}
            </s-text>
          </s-stack>
          <s-button variant="primary" icon="upload" onClick={onImport}>
            {has ? "Import new file" : "Import CSV"}
          </s-button>
        </s-grid>
      </s-box>
      {has && (
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
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    alignItems="center"
                  >
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
                    disabled={!h.hasFile}
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
      )}
    </s-section>
  );
}
