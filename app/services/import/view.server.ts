// What the import card needs to know about a job (sent to the browser).
import type { ImportJob, SearchField } from "@prisma/client";
import { SKIP, targetToChoice, type MapField } from "./mapping";
import type { ColumnsInfo } from "./pipeline.server";

export interface ImportJobView {
  id: string;
  status: ImportJob["status"];
  mode: ImportJob["mode"];
  fileName: string;
  firstRow: string[];
  sampleRows: string[][];
  /** Saved mapping as UI choices per column (null before the mapping step). */
  choices: string[] | null;
  hasHeader: boolean;
  lookForSkus: boolean;
  processedRows: number;
  counts: {
    added: number;
    unchanged: number;
    imported: number;
    deleted: number;
    notFound: number;
    rowsLeft: number;
    errors: number;
  };
  hasReport: boolean;
  failureReason: string | null;
}

export function jobView(job: ImportJob, fields: SearchField[]): ImportJobView {
  const columns = (job.columns as unknown as ColumnsInfo | null) ?? {
    firstRow: [],
    sampleRows: [],
  };
  const mapFields: MapField[] = fields.map((f) => ({
    id: f.id,
    label: f.label,
    type: f.type,
  }));
  const mapping = job.mapping as Record<string, string> | null;
  return {
    id: job.id,
    status: job.status,
    mode: job.mode,
    fileName: job.fileName,
    firstRow: columns.firstRow,
    sampleRows: columns.sampleRows,
    choices: mapping
      ? columns.firstRow.map((_, col) => {
          const t = mapping[String(col)];
          return (t && targetToChoice(t, mapFields)) || SKIP;
        })
      : null,
    hasHeader: job.hasHeader,
    lookForSkus: job.lookForSkus,
    processedRows: job.processedRows,
    counts: {
      added: job.added,
      unchanged: job.unchanged,
      imported: job.imported,
      deleted: job.deleted,
      notFound: job.notFound,
      rowsLeft: job.rowsLeft,
      errors: job.errors,
    },
    hasReport: !!job.reportKey,
    failureReason: job.failureReason,
  };
}
