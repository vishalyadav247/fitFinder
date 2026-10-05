// Import CSV card (specs/search-setup.md › Import): 1 Upload file › 2 Map columns › 3 Review and
// import. Replaces Import history while open. Steps 2–3 talk to /api/imports; the check run and
// the import itself are background jobs, polled here.
import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { ImportJobView } from "../../services/import/view.server";
import {
  ATTACHMENT,
  SKIP,
  pickColumn,
  validateChoices,
  type MapField,
} from "../../services/import/mapping";
import {
  cancelInBackground,
  download,
  fileProblem,
  getJob,
  jobAction,
  saveBlob,
  templateCsv,
  uploadAndCreate,
} from "./client";

type Mode = ImportJobView["mode"];

export const MODE_LABEL: Record<Mode, string> = {
  upsert: "Add and update rows",
  replace: "Replace all rows",
  delete: "Delete the rows listed in this file",
};

const STEPS = ["Upload file", "Map columns", "Review and import"];
const POLL_MS = 1000;
const CONFIRM_MODAL = "import-confirm-modal";

const n = (v: number) => v.toLocaleString("en");

export function ImportCard({
  fields,
  currentRows,
  resume,
  onClose,
}: {
  fields: MapField[];
  /** Filter rows the shop has now (for "Replace all {n} rows?"). */
  currentRows: number;
  /** An import already checking or running when the page opened. */
  resume: ImportJobView | null;
  /** Closes the card; `toast` is shown when an import finished. */
  onClose: (toast?: string) => void;
}) {
  const shopify = useAppBridge();
  const [step, setStep] = useState(resume ? 3 : 1);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>(resume?.mode ?? "upsert");
  const [job, setJob] = useState<ImportJobView | null>(resume);
  const [choices, setChoices] = useState<string[]>(resume?.choices ?? []);
  // Columns in the order they were picked (oldest first), for "reset the oldest".
  const [order, setOrder] = useState<number[]>(() =>
    (resume?.choices ?? [])
      .map((c, i) => (c === SKIP ? -1 : i))
      .filter((i) => i >= 0),
  );
  const [hasHeader, setHasHeader] = useState(resume?.hasHeader ?? true);
  const [lookForSkus, setLookForSkus] = useState(resume?.lookForSkus ?? true);
  const [attachmentError, setAttachmentError] = useState(false);
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const toastError = (message: string) =>
    shopify.toast.show(message, { isError: true });

  // Leaving the page cancels an import that hasn't started (spec).
  const jobRef = useRef(job);
  jobRef.current = job;
  useEffect(
    () => () => {
      const j = jobRef.current;
      if (
        j &&
        (j.status === "uploaded" ||
          j.status === "ready" ||
          j.status === "previewing")
      ) {
        cancelInBackground(j.id);
      }
    },
    [],
  );

  useEffect(() => {
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Poll while a job is checking or importing. A failed poll retries on the next tick; a
  // failed job shows the "The import stopped" banner in step 3 (no toast).
  const [pollTick, setPollTick] = useState(0);
  useEffect(() => {
    if (!job || (job.status !== "previewing" && job.status !== "running"))
      return;
    const timer = setTimeout(async () => {
      const res = await getJob(job.id).catch(() => null);
      if (!res?.job) {
        setPollTick((t) => t + 1);
        return;
      }
      const next = res.job;
      if (job.status === "running" && next.status === "completed") {
        jobRef.current = null;
        onClose(next.mode === "delete" ? "Rows deleted" : "Import finished");
        return;
      }
      setJob(next);
    }, POLL_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, pollTick]);

  // ------------------------------------------------------------ navigation

  async function next() {
    if (step === 1) {
      if (!file) return toastError("Choose a file to import.");
      const problem = fileProblem(file);
      if (problem) return toastError(problem);
      setBusy(true);
      try {
        const res = await uploadAndCreate(file, mode);
        if (!res.job || !res.choices)
          return toastError(res.error ?? "The upload failed.");
        setJob(res.job);
        setChoices(res.choices);
        setOrder(
          res.choices
            .map((c, i) => (c === SKIP ? -1 : i))
            .filter((i) => i >= 0),
        );
        setHasHeader(true);
        setStep(2);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (step === 2 && job) {
      if (validateChoices(choices).attachmentMissing) {
        setAttachmentError(true);
        return;
      }
      setBusy(true);
      try {
        const res = await jobAction(job.id, {
          intent: "map",
          choices,
          hasHeader,
          lookForSkus,
          mode,
        });
        if (!res.job)
          return toastError(res.error ?? "The mapping couldn't be saved.");
        setJob(res.job);
        setStep(3);
      } finally {
        setBusy(false);
      }
    }
  }

  async function startImport() {
    if (!job) return;
    setBusy(true);
    try {
      const res = await jobAction(job.id, { intent: "run" });
      if (!res.job)
        return toastError(res.error ?? "The import couldn't start.");
      setJob(res.job);
      shopify.modal.hide(CONFIRM_MODAL);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    const j = job;
    jobRef.current = null;
    if (j && j.status !== "running") {
      await jobAction(j.id, { intent: "cancel" });
    }
    onClose();
  }

  const running = job?.status === "running";
  const checking = job?.status === "previewing";
  const ready = job?.status === "ready";
  const destructive = mode === "replace" || mode === "delete";

  // ------------------------------------------------------------ render

  return (
    <div ref={cardRef}>
      <s-section accessibilityLabel="Import CSV">
        <h2 className="ff-sec-title" style={{ marginBottom: 12 }}>
          Import CSV
        </h2>
        <s-stack gap="large">
          <ol className="ff-stepper" aria-label="Import steps">
            {STEPS.map((label, i) => {
              const done = step > i + 1;
              const cur = step === i + 1;
              return (
                <li
                  key={label}
                  className={[
                    done && "done",
                    cur && "cur",
                    i > 0 && step > i && "line-on",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-current={cur ? "step" : undefined}
                >
                  <span className="stp">
                    <span className="dot">
                      {done ? <s-icon type="check" size="small" /> : i + 1}
                    </span>
                    <span className="lab">{label}</span>
                  </span>
                </li>
              );
            })}
          </ol>

          {step === 1 && (
            <UploadStep
              mode={mode}
              setMode={setMode}
              setFile={setFile}
              fields={fields}
              onRejected={() => toastError("Choose a .csv or .csv.gz file.")}
            />
          )}
          {step === 2 && job && (
            <MapStep
              job={job}
              fields={fields}
              choices={choices}
              hasHeader={hasHeader}
              lookForSkus={lookForSkus}
              attachmentError={attachmentError}
              onPick={(col, choice) => {
                const r = pickColumn(choices, order, col, choice, fields);
                setChoices(r.choices);
                setOrder(r.order);
                if (choice === ATTACHMENT) setAttachmentError(false);
              }}
              setHasHeader={setHasHeader}
              setLookForSkus={setLookForSkus}
            />
          )}
          {step === 3 && job && (
            <ReviewStep
              job={job}
              currentRows={currentRows}
              onError={toastError}
            />
          )}

          <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
            <s-box>
              {step > 1 && !running && !checking && (
                <s-button onClick={() => setStep(step - 1)} disabled={busy}>
                  Back
                </s-button>
              )}
            </s-box>
            <s-stack direction="inline" gap="small-200">
              <s-button onClick={cancel} disabled={busy || running}>
                Cancel import
              </s-button>
              {step < 3 ? (
                <s-button variant="primary" loading={busy} onClick={next}>
                  Next
                </s-button>
              ) : destructive ? (
                <s-button
                  variant="primary"
                  tone="critical"
                  commandFor={CONFIRM_MODAL}
                  command="--show"
                  disabled={!ready}
                  loading={running}
                >
                  Start import
                </s-button>
              ) : (
                <s-button
                  variant="primary"
                  disabled={!ready}
                  loading={busy || running}
                  onClick={startImport}
                >
                  Start import
                </s-button>
              )}
            </s-stack>
          </s-grid>
        </s-stack>
      </s-section>

      <s-modal
        id={CONFIRM_MODAL}
        heading={
          mode === "replace"
            ? `Replace all ${n(currentRows)} rows?`
            : "Delete the rows listed in this file?"
        }
        size="small"
      >
        <s-paragraph>
          {mode === "replace"
            ? "Every current filter row is deleted, then the file is imported. Download a backup from Import history first if you may need them. This can't be undone."
            : `Rows in your filter data that match ${job?.fileName ?? "this file"} exactly will be deleted. This can't be undone.`}
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={busy}
          onClick={startImport}
        >
          {mode === "replace" ? "Replace all rows" : "Delete rows"}
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor={CONFIRM_MODAL}
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>
    </div>
  );
}

// ------------------------------------------------------------ step 1

function UploadStep({
  mode,
  setMode,
  setFile,
  fields,
  onRejected,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  setFile: (f: File | null) => void;
  fields: MapField[];
  onRejected: () => void;
}) {
  return (
    <s-stack gap="base">
      <s-drop-zone
        label="Upload a .csv or .csv.gz file, up to 100 MB"
        accept=".csv,.gz"
        onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
        onDropRejected={onRejected}
      />
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-text color="subdued">Not sure about the format?</s-text>
        <s-button
          variant="tertiary"
          icon="download"
          onClick={() =>
            saveBlob(
              templateCsv(fields.map((f) => f.label)),
              "filter-data-template.csv",
            )
          }
        >
          Download a CSV template
        </s-button>
      </s-stack>
      <s-choice-list
        label="What should this import do?"
        onChange={(e) => {
          const v = e.currentTarget.values?.[0] as Mode | undefined;
          if (v) setMode(v);
        }}
      >
        <s-choice value="upsert" selected={mode === "upsert"}>
          Add and update rows (recommended)
          <s-text slot="details">
            New rows are added. Rows already in your data stay.
          </s-text>
        </s-choice>
        <s-choice value="replace" selected={mode === "replace"}>
          Replace all rows
          <s-text slot="details">
            Deletes every current row first, then imports the file.
          </s-text>
        </s-choice>
        <s-choice value="delete" selected={mode === "delete"}>
          Delete the rows listed in this file
          <s-text slot="details">
            Removes rows that match the file exactly. Rows not in the file stay.
          </s-text>
        </s-choice>
      </s-choice-list>
    </s-stack>
  );
}

// ------------------------------------------------------------ step 2

function MapStep({
  job,
  fields,
  choices,
  hasHeader,
  lookForSkus,
  attachmentError,
  onPick,
  setHasHeader,
  setLookForSkus,
}: {
  job: ImportJobView;
  fields: MapField[];
  choices: string[];
  hasHeader: boolean;
  lookForSkus: boolean;
  attachmentError: boolean;
  onPick: (col: number, choice: string) => void;
  setHasHeader: (v: boolean) => void;
  setLookForSkus: (v: boolean) => void;
}) {
  const structure = fields.map((f) => f.label).join(" / ");
  const yearFields = fields.filter((f) => f.type === "year_range");
  const options: [string, string][] = [
    [SKIP, "Map column"],
    ...fields.map((f): [string, string] => [f.id, f.label]),
    [ATTACHMENT, "Attachment"],
  ];
  const titles = job.firstRow;
  // Without column titles the first row is data: show it with the samples.
  const rows = hasHeader
    ? job.sampleRows
    : [job.firstRow, ...job.sampleRows].slice(0, 3);

  return (
    <s-stack gap="base">
      <s-stack gap="none">
        <s-text type="strong">
          Map the columns in your file to your search fields ({structure}) and
          the Attachment.
        </s-text>
        <s-text color="subdued">
          Columns you don&apos;t map are ignored. The first rows of your file
          are shown below. We filled in the mapping from your last import.
        </s-text>
      </s-stack>
      <s-checkbox
        label="Column titles in the first row"
        checked={hasHeader}
        onChange={(e) => setHasHeader(e.currentTarget.checked)}
      />
      <div className="ff-map-scroll">
        <table className={`ff-map-grid${hasHeader ? "" : " no-titles"}`}>
          <thead>
            <tr>
              {titles.map((name, col) => (
                <th key={col}>
                  <s-select
                    label={`Map ${hasHeader && name ? name : `column ${col + 1}`}`}
                    labelAccessibilityVisibility="exclusive"
                    value={choices[col] ?? SKIP}
                    onChange={(e) => onPick(col, e.currentTarget.value)}
                  >
                    {options.map(([v, l]) => (
                      <s-option key={v} value={v}>
                        {l}
                      </s-option>
                    ))}
                  </s-select>
                </th>
              ))}
            </tr>
            {hasHeader && (
              <tr className="mg-titles">
                {titles.map((name, col) => (
                  <td key={col}>{name}</td>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {titles.map((_, col) => (
                  <td key={col}>{r[col] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <s-checkbox
        label="Look for SKUs in the Attachment column"
        details="Check it if the Attachment column has product SKUs. It can make the import take longer. Leave it off for product or collection links."
        checked={lookForSkus}
        onChange={(e) => setLookForSkus(e.currentTarget.checked)}
      />
      {attachmentError && (
        <s-banner tone="critical" heading="Map the Attachment column">
          Each row needs an Attachment: the product SKU, product link or
          collection link it points to.
        </s-banner>
      )}
      <s-text color="subdued">
        {yearFields.length > 0 &&
          `${yearFields.map((f) => f.label).join(", ")} can use one column (like 2015-2020) or two columns: the left one is from, the right one is to. `}
        Missing a field? Add it under Fields shoppers pick, then map a column to
        it.
      </s-text>
    </s-stack>
  );
}

// ------------------------------------------------------------ step 3

function ReviewStep({
  job,
  currentRows,
  onError,
}: {
  job: ImportJobView;
  currentRows: number;
  onError: (message: string) => void;
}) {
  const c = job.counts;

  if (job.status === "previewing" || job.status === "running") {
    return (
      <s-stack gap="base" alignItems="center">
        <s-spinner accessibilityLabel="Working" />
        <s-text color="subdued">
          {job.status === "previewing"
            ? `Checking your file… ${n(job.processedRows)} rows read`
            : "Importing… You can leave this page; the import keeps running."}
        </s-text>
      </s-stack>
    );
  }
  if (job.status === "failed") {
    return (
      <s-banner tone="critical" heading="The import stopped">
        {job.failureReason ?? "Nothing was changed."}
      </s-banner>
    );
  }

  const counts: [string, number][] =
    job.mode === "delete"
      ? [
          ["Rows deleted", c.deleted],
          ["Not found", c.notFound],
          ["Rows left", c.rowsLeft],
        ]
      : job.mode === "replace"
        ? [
            ["Current rows deleted", c.deleted || currentRows],
            ["Rows imported", c.imported],
            ["Errors", c.errors],
          ]
        : [
            ["Rows added", c.added],
            ["Unchanged", c.unchanged],
            ["Errors", c.errors],
          ];

  const reportName =
    job.mode === "delete" ? "Not found report" : "Error report";
  const note =
    job.mode === "delete"
      ? {
          heading: "Only exact matches are deleted",
          text: "A row is deleted when every mapped column matches. Rows in the file with no match are listed in the report.",
        }
      : job.mode === "replace"
        ? {
            heading: "All current rows are deleted first",
            text: "Download a backup from Import history if you may need them. Rows with errors are skipped.",
          }
        : {
            heading: "Rows with errors are skipped. Everything else imports.",
            text: "For example an empty required field, or a year that can't be read.",
          };

  return (
    <s-stack gap="base">
      <s-text color="subdued">
        {job.fileName} · {MODE_LABEL[job.mode]}
      </s-text>
      <s-grid
        gridTemplateColumns={`repeat(${counts.length}, minmax(0, 1fr))`}
        gap="base"
      >
        {counts.map(([label, value]) => (
          <s-box
            key={label}
            padding="base"
            background="subdued"
            borderRadius="base"
          >
            <s-stack gap="none">
              <s-text color="subdued">{label}</s-text>
              <s-text type="strong">{n(value)}</s-text>
            </s-stack>
          </s-box>
        ))}
      </s-grid>
      <s-banner tone="warning" heading={note.heading}>
        <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
          <s-text>{note.text}</s-text>
          {job.hasReport && (
            <s-button
              variant="tertiary"
              icon="download"
              onClick={async () => {
                const ok = await download(
                  `/api/imports/${job.id}/file?report=1`,
                  "import-report.csv",
                );
                if (!ok) onError("The report couldn't be downloaded.");
              }}
            >
              {reportName}
            </s-button>
          )}
        </s-grid>
      </s-banner>
    </s-stack>
  );
}
