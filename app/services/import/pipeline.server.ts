// The import pipeline (specs/search-setup.md › Import; BUILD-PLAN §4 Import):
//   create  — file is in storage; read the first rows, pre-fill the mapping (status uploaded)
//   map     — save the mapping, queue the check run (status previewing)
//   preview — job: stream the file into import_rows, hash rows in SQL, count per mode,
//             write the error / not-found report (status ready)
//   run     — job: apply import_rows to fitment_rows in one transaction under the shop's setup
//             lock, save the mapping, keep the 5 newest files (status completed)
// Every query is scoped by shop (jobs carry their shopId; staging rows hang off the job).
import { Prisma } from "@prisma/client";
import type { ImportJob, ImportMode, SearchField } from "@prisma/client";
import { Readable } from "node:stream";
import prisma from "../../db.server";
import { CURRENT, rowHashSql } from "../fitment/row-hash.server";
import { MAX_UPLOAD_BYTES, keyBelongsToShop, storage } from "../storage.server";
import {
  CsvEncodingError,
  CsvTooLargeError,
  openCsv,
  readPreview,
} from "./csv-reader.server";
import {
  ATTACHMENT,
  SKIP,
  guessChoices,
  resolveChoices,
  targetToString,
  validateChoices,
  type MapField,
  type ResolvedTarget,
} from "./mapping";
import { buildRow } from "./transform";

export const KEEP_FILES = 5;
const STAGE_BATCH = 10000;
const SAMPLE_ROWS = 3;
const RUN_TIMEOUT_MS = 30 * 60 * 1000;
/** Most rows one import may have (plan limits replace this in M9). */
export const MAX_ROWS = 2_000_000;
// Running steps touch their job row this often; a job silent for STALE_MS is treated as dead
// (worker crash, redeploy) so the shop isn't locked out of importing.
const HEARTBEAT_MS = 30_000;
export const STALE_MS = 3 * 60_000;
// A step waiting in the queue behind other shops' imports (each run may take up to 30 min) is
// only treated as lost after this long. pg-boss's expireInSeconds covers active time only, so
// this is our own limit for "no worker ever picked it up".
export const QUEUE_STALE_MS = 6 * 60 * 60_000;
const STALE_REASON = "The import stopped unexpectedly. Nothing was changed.";
const NOTHING_TO_REPLACE =
  "This file has no rows that can be imported, so Replace all rows would delete everything. Nothing was changed.";

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

export interface ColumnsInfo {
  firstRow: string[];
  sampleRows: string[][];
}

const ACTIVE: ImportJob["status"][] = ["previewing", "running"];
const DRAFT: ImportJob["status"][] = ["uploaded", "ready"];

function toMapFields(fields: SearchField[]): MapField[] {
  return fields.map((f) => ({
    id: f.id,
    label: f.label,
    type: f.type,
    required: f.required,
  }));
}

async function shopFields(shopId: string) {
  return prisma.searchField.findMany({
    where: { shopId },
    orderBy: { position: "asc" },
  });
}

export async function getJob(shopId: string, jobId: string) {
  const job = await prisma.importJob.findFirst({
    where: { id: jobId, shopId },
  });
  if (!job) throw new ImportError("This import no longer exists.");
  return job;
}

/**
 * Marks checking / running jobs that stopped sending heartbeats as failed (their transaction, if
 * any, was rolled back). All shops when no shopId is given.
 */
export async function sweepStale(shopId?: string) {
  const now = Date.now();
  const stale = await prisma.importJob.findMany({
    where: {
      ...(shopId ? { shopId } : {}),
      status: { in: ACTIVE },
      OR: [
        // claimed by a worker that stopped sending heartbeats
        {
          claimedAt: { not: null },
          updatedAt: { lt: new Date(now - STALE_MS) },
        },
        // never claimed within the queue's own expiry (worker down)
        {
          claimedAt: null,
          updatedAt: { lt: new Date(now - QUEUE_STALE_MS) },
        },
      ],
    },
    select: { id: true },
  });
  for (const { id } of stale) {
    const { count } = await prisma.importJob.updateMany({
      where: { id, status: { in: ACTIVE } },
      data: {
        status: "failed",
        failureReason: STALE_REASON,
        finishedAt: new Date(),
      },
    });
    // Only clean up a job this sweep failed (it may have finished meanwhile).
    if (count === 1) await cleanUp(id);
  }
}

/** Keeps a running step's job row fresh; stops when the step ends. */
async function withHeartbeat<T>(
  jobId: string,
  status: ImportJob["status"],
  fn: () => Promise<T>,
): Promise<T> {
  const timer = setInterval(() => {
    prisma.importJob
      .updateMany({
        where: { id: jobId, status },
        data: { updatedAt: new Date() },
      })
      .catch((error) =>
        console.error("import heartbeat failed", { jobId, error }),
      );
  }, HEARTBEAT_MS);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

async function cleanUp(jobId: string) {
  await prisma.importRow.deleteMany({ where: { jobId } });
}

/** The import a shop is working on (draft or running), if any. */
export async function currentJob(shopId: string) {
  await sweepStale(shopId);
  return prisma.importJob.findFirst({
    where: { shopId, status: { in: [...DRAFT, ...ACTIVE] } },
    orderBy: { createdAt: "desc" },
  });
}

/** Import history: the newest finished imports that still have their file. */
export function importHistory(shopId: string) {
  return prisma.importJob.findMany({
    where: { shopId, status: "completed" },
    orderBy: { finishedAt: "desc" },
    take: KEEP_FILES,
  });
}

// ---------------------------------------------------------------- create

export async function createImport(
  shopId: string,
  input: { key: string; fileName: string; mode: ImportMode },
) {
  if (!keyBelongsToShop(input.key, shopId)) {
    throw new ImportError("That upload doesn't belong to this store.");
  }
  const size = await storage().size(input.key);
  if (size === null)
    throw new ImportError("The upload didn't arrive. Try again.");
  if (size > MAX_UPLOAD_BYTES) {
    await storage().delete(input.key);
    throw new ImportError("The file is larger than 100 MB.");
  }

  await sweepStale(shopId);
  const running = await prisma.importJob.findFirst({
    where: { shopId, status: { in: ACTIVE } },
  });
  if (running) {
    await storage().delete(input.key);
    throw new ImportError(
      "An import is already running. Wait for it to finish.",
    );
  }
  // Starting a new import cancels an unfinished one (spec: leaving cancels) and clears the
  // files of failed ones.
  const drafts = await prisma.importJob.findMany({
    where: {
      shopId,
      OR: [
        { status: { in: DRAFT } },
        { status: "failed", fileKey: { not: null } },
      ],
    },
  });
  for (const d of drafts) await discard(d, [...DRAFT, "failed"]);

  let preview;
  try {
    preview = await readPreview(await storage().get(input.key), SAMPLE_ROWS);
  } catch {
    await storage().delete(input.key);
    throw new ImportError("This file can't be read as a CSV.");
  }
  if (preview.firstRow.length === 0) {
    await storage().delete(input.key);
    throw new ImportError("This file is empty.");
  }

  const columns: ColumnsInfo = {
    firstRow: preview.firstRow,
    sampleRows: preview.sampleRows,
  };
  const job = await prisma.importJob.create({
    data: {
      shopId,
      fileName: input.fileName.slice(0, 255),
      fileKey: input.key,
      fileSize: BigInt(size),
      mode: input.mode,
      columns: columns as unknown as Prisma.InputJsonValue,
      delimiter: preview.delimiter,
      encoding: preview.encoding,
      status: "uploaded",
    },
  });
  return { job, choices: await prefill(shopId, preview.firstRow) };
}

/** Pre-filled mapping for the file's column titles (saved mapping, then header names). */
export async function prefill(shopId: string, headers: string[]) {
  const [fields, saved] = await Promise.all([
    shopFields(shopId),
    prisma.importMapping.findMany({ where: { shopId } }),
  ]);
  return guessChoices(headers, toMapFields(fields), saved);
}

// ---------------------------------------------------------------- map

export async function saveMapping(
  shopId: string,
  jobId: string,
  input: {
    choices: string[];
    hasHeader: boolean;
    lookForSkus: boolean;
    mode: ImportMode;
  },
) {
  const job = await getJob(shopId, jobId);
  if (!DRAFT.includes(job.status)) {
    throw new ImportError("This import can't be changed now.");
  }
  const columns = job.columns as unknown as ColumnsInfo;
  if (input.choices.length !== columns.firstRow.length) {
    throw new ImportError("The mapping doesn't match the file's columns.");
  }
  const fields = toMapFields(await shopFields(shopId));
  const known = new Set([SKIP, ATTACHMENT, ...fields.map((f) => f.id)]);
  if (input.choices.some((c) => !known.has(c))) {
    throw new ImportError("Your search fields changed. Map the columns again.");
  }
  if (validateChoices(input.choices).attachmentMissing) {
    throw new ImportError("Map the Attachment column");
  }

  const mapping: Record<string, string> = {};
  resolveChoices(input.choices, fields).forEach((t, col) => {
    if (t) mapping[String(col)] = targetToString(t);
  });

  // Guarded: a double click or a second tab can't queue the same check run twice.
  const { count } = await prisma.importJob.updateMany({
    where: { id: jobId, shopId, status: { in: DRAFT } },
    data: {
      mapping,
      hasHeader: input.hasHeader,
      lookForSkus: input.lookForSkus,
      mode: input.mode,
      status: "previewing",
      processedRows: 0,
      totalRows: null,
      added: 0,
      unchanged: 0,
      imported: 0,
      deleted: 0,
      notFound: 0,
      rowsLeft: 0,
      errors: 0,
      reportKey: null,
      failureReason: null,
      claimedAt: null,
      attempt: { increment: 1 },
    },
  });
  if (count === 0) throw new ImportError("This import can't be changed now.");
  await cleanUp(jobId);
  if (job.reportKey) await deleteQuietly(job.reportKey);
  const { attempt } = await prisma.importJob.findUniqueOrThrow({
    where: { id: jobId },
    select: { attempt: true },
  });
  return attempt;
}

/** Back to the mapping step when the check run couldn't be queued. */
export async function undoMapping(jobId: string) {
  await prisma.importJob.updateMany({
    where: { id: jobId, status: "previewing", claimedAt: null },
    data: { status: "uploaded" },
  });
}

/** Back to Review when the import couldn't be queued. */
export async function undoStart(jobId: string) {
  await prisma.importJob.updateMany({
    where: { id: jobId, status: "running", claimedAt: null },
    data: { status: "ready" },
  });
}

// ---------------------------------------------------------------- preview (job)

function parseTargets(
  mapping: Record<string, string>,
  columnCount: number,
  fields: MapField[],
): (ResolvedTarget | null)[] {
  const ids = new Set(fields.map((f) => f.id));
  return Array.from({ length: columnCount }, (_, col) => {
    const t = mapping[String(col)];
    if (!t) return null;
    if (t === ATTACHMENT) return { kind: "attachment" };
    const m = t.match(/^field:([^:]+)(?::(range|from|to))?$/);
    if (!m || !ids.has(m[1])) {
      throw new ImportError(
        "Your search fields changed. Map the columns again.",
      );
    }
    return m[2]
      ? { kind: m[2] as "range" | "from" | "to", fieldId: m[1] }
      : { kind: "list", fieldId: m[1] };
  });
}

/** Still the state this step expects? (cancel / restart stop a running step) */
async function stillIn(jobId: string, status: ImportJob["status"]) {
  const j = await prisma.importJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  return j?.status === status;
}

/**
 * A worker claims the step it was queued for: only if the job is still in that status, still
 * on that attempt and not claimed yet. Duplicate or outdated queue messages do nothing.
 */
async function claim(
  jobId: string,
  status: ImportJob["status"],
  attempt: number | undefined,
) {
  const { count } = await prisma.importJob.updateMany({
    where: {
      id: jobId,
      status,
      claimedAt: null,
      ...(attempt === undefined ? {} : { attempt }),
    },
    data: { claimedAt: new Date() },
  });
  return count === 1;
}

export async function runPreview(jobId: string, attempt?: number) {
  if (!(await claim(jobId, "previewing", attempt))) return;
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "previewing" || !job.fileKey) return;
  try {
    await withHeartbeat(jobId, "previewing", async () => {
      if (!(await stageWithFallback(job))) return cleanUp(jobId);
      const counts = await countPreview(job);
      if (job.mode === "replace" && counts.imported === 0) {
        throw new ImportError(NOTHING_TO_REPLACE);
      }
      const reportKey = await writeReport(job);
      const { count } = await prisma.importJob.updateMany({
        where: { id: jobId, status: "previewing" },
        data: { ...counts, reportKey, status: "ready" },
      });
      // Cancelled meanwhile: nothing may stay behind.
      if (count === 0) {
        if (reportKey) await deleteQuietly(reportKey);
        await cleanUp(jobId);
      }
    });
  } catch (error) {
    await failJob(jobId, error);
  }
}

/**
 * Stages the file. A file that looked like UTF-8 in its first 64 KB but isn't is read again as
 * Windows-1252. Returns false when the job was cancelled meanwhile.
 */
async function stageWithFallback(job: ImportJob): Promise<boolean> {
  try {
    return await stage(job);
  } catch (error) {
    if (!(error instanceof CsvEncodingError)) throw error;
    await prisma.importJob.update({
      where: { id: job.id },
      data: { encoding: "windows-1252" },
    });
    return stage(job, "windows-1252");
  }
}

async function stage(
  job: ImportJob,
  encoding?: "utf-8" | "windows-1252",
): Promise<boolean> {
  const fields = toMapFields(await shopFields(job.shopId));
  const columns = job.columns as unknown as ColumnsInfo;
  const targets = parseTargets(
    job.mapping as Record<string, string>,
    columns.firstRow.length,
    fields,
  );
  await prisma.importRow.deleteMany({ where: { jobId: job.id } });

  const csv = await openCsv(await storage().get(job.fileKey!), { encoding });
  const now = new Date();
  // Column arrays for one INSERT ... SELECT FROM unnest(...) per batch (much faster than
  // createMany); row_hash is computed in the same statement with the app's formula.
  // Arrays of only nulls arrive typed int[], hence the ::text[] step before ::jsonb[].
  type Batch = {
    line: number[];
    values: string[];
    yearFrom: (number | null)[];
    yearTo: (number | null)[];
    attachment: string[];
    error: (string | null)[];
    raw: (string | null)[];
  };
  const empty = (): Batch => ({
    line: [],
    values: [],
    yearFrom: [],
    yearTo: [],
    attachment: [],
    error: [],
    raw: [],
  });
  let batch = empty();
  let processed = 0;
  let first = true;

  const flush = async () => {
    if (batch.line.length === 0) return;
    const b = batch;
    batch = empty();
    await prisma.$executeRaw`
      INSERT INTO import_rows
        (job_id, line, "values", year_from, year_to, attachment, error, raw, row_hash)
      SELECT ${job.id}, r.line, r."values", r.year_from, r.year_to, r.attachment, r.error, r.raw,
        CASE WHEN r.error IS NULL THEN ${rowHashSql(CURRENT, "r")} END
      FROM unnest(
        ${b.line}::int[], ${b.values}::text[]::jsonb[], ${b.yearFrom}::int[], ${b.yearTo}::int[],
        ${b.attachment}::text[], ${b.error}::text[], ${b.raw}::text[]::jsonb[]
      ) AS r(line, "values", year_from, year_to, attachment, error, raw)`;
    await prisma.importJob.update({
      where: { id: job.id },
      data: { processedRows: processed },
    });
  };

  try {
    for await (const record of csv.records) {
      if (first && job.hasHeader) {
        first = false;
        continue;
      }
      first = false;
      const row = buildRow(record.cells, targets, fields, now);
      batch.line.push(record.line);
      batch.values.push(JSON.stringify(row.values));
      batch.yearFrom.push(row.yearFrom);
      batch.yearTo.push(row.yearTo);
      batch.attachment.push(row.attachment);
      batch.error.push(row.error);
      batch.raw.push(row.raw ? JSON.stringify(row.raw) : null);
      processed++;
      if (processed > MAX_ROWS) {
        throw new ImportError(
          `This file has more than ${MAX_ROWS.toLocaleString("en")} rows. Split it into smaller files.`,
        );
      }
      if (batch.line.length >= STAGE_BATCH) {
        // Checked before writing, so a cancelled job gets no new staging rows.
        if (!(await stillIn(job.id, "previewing"))) return false;
        await flush();
      }
    }
    if (!(await stillIn(job.id, "previewing"))) return false;
    await flush();
  } catch (error) {
    if (error instanceof CsvTooLargeError) {
      throw new ImportError(
        "This file is too large once unpacked. Split it into smaller files.",
      );
    }
    throw error;
  } finally {
    csv.close();
  }

  await prisma.importJob.update({
    where: { id: job.id },
    data: { processedRows: processed, totalRows: processed },
  });
  return true;
}

async function countPreview(job: ImportJob) {
  const [row] = await prisma.$queryRaw<
    {
      valid: number;
      errors: number;
      new_distinct: number;
      distinct_valid: number;
      current: number;
      matched: number;
      not_found: number;
    }[]
  >`
    WITH valid AS (
      SELECT row_hash FROM import_rows WHERE job_id = ${job.id} AND error IS NULL
    )
    SELECT
      (SELECT count(*) FROM valid)::int AS valid,
      (SELECT count(*) FROM import_rows WHERE job_id = ${job.id} AND error IS NOT NULL)::int AS errors,
      (SELECT count(DISTINCT v.row_hash) FROM valid v WHERE NOT EXISTS (
        SELECT 1 FROM fitment_rows f WHERE f.shop_id = ${job.shopId} AND f.row_hash = v.row_hash
      ))::int AS new_distinct,
      (SELECT count(DISTINCT row_hash) FROM valid)::int AS distinct_valid,
      (SELECT count(*) FROM fitment_rows WHERE shop_id = ${job.shopId})::int AS current,
      (SELECT count(*) FROM fitment_rows f WHERE f.shop_id = ${job.shopId}
        AND f.row_hash IN (SELECT row_hash FROM valid))::int AS matched,
      (SELECT count(*) FROM valid v WHERE NOT EXISTS (
        SELECT 1 FROM fitment_rows f WHERE f.shop_id = ${job.shopId} AND f.row_hash = v.row_hash
      ))::int AS not_found`;

  if (job.mode === "upsert") {
    return {
      added: row.new_distinct,
      unchanged: row.valid - row.new_distinct,
      errors: row.errors,
    };
  }
  if (job.mode === "replace") {
    return {
      deleted: row.current,
      imported: row.distinct_valid,
      errors: row.errors,
    };
  }
  return {
    deleted: row.matched,
    notFound: row.not_found,
    rowsLeft: row.current - row.matched,
    errors: row.errors,
  };
}

/** CSV cell; text a spreadsheet would run as a formula gets a leading apostrophe. */
export function csvCell(v: unknown): string {
  let s = `${v ?? ""}`;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Error report (add / replace: rows with errors) or not-found report (delete: rows with no exact
 * match, plus rows with errors). Null when there's nothing to report.
 */
async function writeReport(job: ImportJob): Promise<string | null> {
  const fields = await shopFields(job.shopId);
  const wantNotFound = job.mode === "delete";
  const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM import_rows i
    WHERE i.job_id = ${job.id} AND (i.error IS NOT NULL OR (${wantNotFound} AND NOT EXISTS (
      SELECT 1 FROM fitment_rows f WHERE f.shop_id = ${job.shopId} AND f.row_hash = i.row_hash)))`;
  if (n === 0) return null;

  const yearField = fields.find((f) => f.type === "year_range");
  const header = [
    "Line",
    "Problem",
    ...fields.map((f) => f.label),
    "Attachment",
  ];

  async function* lines() {
    yield header.map(csvCell).join(",") + "\n";
    let after = BigInt(0);
    for (;;) {
      const rows = await prisma.$queryRaw<
        {
          id: bigint;
          line: number;
          error: string | null;
          values: Record<string, string>;
          year_from: number | null;
          year_to: number | null;
          attachment: string;
          raw: Record<string, string> | null;
        }[]
      >`
        SELECT i.id, i.line, i.error, i."values", i.year_from, i.year_to, i.attachment, i.raw
        FROM import_rows i
        WHERE i.job_id = ${job.id} AND i.id > ${after}
          AND (i.error IS NOT NULL OR (${wantNotFound} AND NOT EXISTS (
            SELECT 1 FROM fitment_rows f WHERE f.shop_id = ${job.shopId} AND f.row_hash = i.row_hash)))
        ORDER BY i.id LIMIT 10000`;
      if (rows.length === 0) return;
      for (const r of rows) {
        const cells = fields.map((f) => {
          if (r.raw) {
            if (r.raw[f.label] !== undefined) return r.raw[f.label];
            const from = r.raw[`${f.label} from`];
            const to = r.raw[`${f.label} to`];
            return from !== undefined || to !== undefined
              ? `${from ?? ""} - ${to ?? ""}`
              : "";
          }
          if (f.id === yearField?.id) {
            if (r.year_from === null) return "";
            return r.year_to === r.year_from
              ? String(r.year_from)
              : `${r.year_from}-${r.year_to ?? ""}`;
          }
          return r.values[f.id] ?? "";
        });
        const attachment = r.raw ? (r.raw.Attachment ?? "") : r.attachment;
        const problem = r.error ?? "No exact match";
        yield [r.line, problem, ...cells, attachment].map(csvCell).join(",") +
          "\n";
      }
      after = rows[rows.length - 1].id;
    }
  }

  const key = job.fileKey!.replace(/[^/]+$/, `report-${job.id}.csv`);
  await storage().put(key, Readable.from(lines()));
  return key;
}

// ---------------------------------------------------------------- run (job)

/** Starts the import; returns the attempt number to put in the queue message. */
export async function startRun(shopId: string, jobId: string) {
  const { count } = await prisma.importJob.updateMany({
    where: { id: jobId, shopId, status: "ready" },
    data: {
      status: "running",
      processedRows: 0,
      claimedAt: null,
      attempt: { increment: 1 },
    },
  });
  if (count === 0) throw new ImportError("This import isn't ready to start.");
  const job = await prisma.importJob.findUniqueOrThrow({
    where: { id: jobId },
    select: { attempt: true },
  });
  return job.attempt;
}

export async function runImport(jobId: string, attempt?: number) {
  if (!(await claim(jobId, "running", attempt))) return;
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "running") return;
  try {
    // The job is marked completed inside the transaction (see apply), so the data and the
    // status commit together.
    await withHeartbeat(jobId, "running", () => apply(job));
  } catch (error) {
    await failJob(jobId, error);
    return;
  }
  // The data is committed: housekeeping problems are logged, never reported as a failed import.
  try {
    await saveJobMapping(job);
    await cleanUp(jobId);
    await keepNewestFiles(job.shopId);
  } catch (error) {
    console.error("import housekeeping failed", {
      shopId: job.shopId,
      jobId,
      error,
    });
  }
}

/**
 * Applies the staged rows and marks the job completed in the same transaction. If the job was
 * swept or cancelled meanwhile, the guarded completion matches nothing and everything rolls back
 * (the staging rows may have been deleted under us, so a commit could lose data).
 */
async function apply(job: ImportJob) {
  return prisma.$transaction(
    async (tx) => {
      const result = await applyRows(tx, job);
      const done = await tx.importJob.updateMany({
        where: { id: job.id, status: "running" },
        data: { ...result, status: "completed", finishedAt: new Date() },
      });
      if (done.count === 0) {
        throw new ImportError(STALE_REASON);
      }
      return result;
    },
    { timeout: RUN_TIMEOUT_MS, maxWait: 30_000 },
  );
}

async function applyRows(tx: Prisma.TransactionClient, job: ImportJob) {
  // Same lock as field changes and store type replace (M2/M3): they can't interleave.
  const locked = await tx.$queryRaw<unknown[]>`
        SELECT 1 FROM search_configs WHERE shop_id = ${job.shopId} FOR UPDATE`;
  if (locked.length === 0) throw new ImportError("Set up your store first.");

  const fields = toMapFields(
    await tx.searchField.findMany({ where: { shopId: job.shopId } }),
  );
  const columns = job.columns as unknown as ColumnsInfo;
  parseTargets(
    job.mapping as Record<string, string>,
    columns.firstRow.length,
    fields,
  );

  const [{ valid, errors }] = await tx.$queryRaw<
    { valid: number; errors: number }[]
  >`
        SELECT count(*) FILTER (WHERE error IS NULL)::int AS valid,
               count(*) FILTER (WHERE error IS NOT NULL)::int AS errors
        FROM import_rows WHERE job_id = ${job.id}`;

  const insertNew = () => tx.$executeRaw`
        INSERT INTO fitment_rows (shop_id, "values", year_from, year_to, attachment, row_hash, updated_at)
        SELECT DISTINCT ON (row_hash) ${job.shopId}, "values", year_from, year_to, attachment, row_hash, now()
        FROM import_rows
        WHERE job_id = ${job.id} AND error IS NULL
        ORDER BY row_hash, line
        ON CONFLICT (shop_id, row_hash) DO NOTHING`;

  if (job.mode === "upsert") {
    const added = await insertNew();
    return { added, unchanged: valid - added, errors };
  }
  if (job.mode === "replace") {
    if (valid === 0) throw new ImportError(NOTHING_TO_REPLACE);
    const deleted = await tx.fitmentRow.deleteMany({
      where: { shopId: job.shopId },
    });
    const imported = await insertNew();
    return { deleted: deleted.count, imported, errors };
  }
  // Count rows with no exact match before deleting the matches.
  const [{ notFound }] = await tx.$queryRaw<{ notFound: number }[]>`
        SELECT count(*)::int AS "notFound" FROM import_rows i
        WHERE i.job_id = ${job.id} AND i.error IS NULL AND NOT EXISTS (
          SELECT 1 FROM fitment_rows f WHERE f.shop_id = ${job.shopId} AND f.row_hash = i.row_hash)`;
  const deleted = await tx.$executeRaw`
        DELETE FROM fitment_rows f
        WHERE f.shop_id = ${job.shopId} AND f.row_hash IN (
          SELECT row_hash FROM import_rows WHERE job_id = ${job.id} AND error IS NULL)`;
  const [{ left }] = await tx.$queryRaw<{ left: number }[]>`
        SELECT count(*)::int AS left FROM fitment_rows WHERE shop_id = ${job.shopId}`;
  return { deleted, rowsLeft: left, notFound, errors };
}

/** Saves this import's mapping by column title, replacing the previous one. */
async function saveJobMapping(job: ImportJob) {
  const columns = job.columns as unknown as ColumnsInfo;
  const mapping = job.mapping as Record<string, string>;
  const data = Object.entries(mapping).map(([col, target]) => ({
    shopId: job.shopId,
    columnName: job.hasHeader
      ? columns.firstRow[Number(col)] || `Column ${Number(col) + 1}`
      : `Column ${Number(col) + 1}`,
    target,
  }));
  const unique = [...new Map(data.map((d) => [d.columnName, d])).values()];
  await prisma.$transaction([
    prisma.importMapping.deleteMany({ where: { shopId: job.shopId } }),
    prisma.importMapping.createMany({ data: unique }),
  ]);
}

/** Keeps the files of the newest KEEP_FILES finished imports; older files are deleted. */
export async function keepNewestFiles(shopId: string) {
  const old = await prisma.importJob.findMany({
    where: {
      shopId,
      status: "completed",
      OR: [{ fileKey: { not: null } }, { reportKey: { not: null } }],
    },
    orderBy: { finishedAt: "desc" },
    skip: KEEP_FILES,
  });
  for (const j of old) {
    if (j.fileKey) await deleteQuietly(j.fileKey);
    if (j.reportKey) await deleteQuietly(j.reportKey);
    await prisma.importJob.update({
      where: { id: j.id },
      data: { fileKey: null, reportKey: null },
    });
  }
}

// ---------------------------------------------------------------- cancel / fail

/** Deletes a stored file; a storage error is logged, not thrown. */
async function deleteQuietly(key: string) {
  try {
    await storage().delete(key);
  } catch (error) {
    console.error("storage delete failed", { key, error });
  }
}

/**
 * Cancels a job and deletes its staging rows and files, only if it is still in one of `from`.
 * A guarded transition: it can't race a start (ready → running) or a running step.
 */
async function discard(job: ImportJob, from: ImportJob["status"][]) {
  const { count } = await prisma.importJob.updateMany({
    where: { id: job.id, status: { in: from } },
    data: { status: "cancelled", finishedAt: new Date() },
  });
  if (count === 0) return false;
  await cleanUp(job.id);
  if (job.fileKey) await deleteQuietly(job.fileKey);
  if (job.reportKey) await deleteQuietly(job.reportKey);
  await prisma.importJob.update({
    where: { id: job.id },
    data: { fileKey: null, reportKey: null },
  });
  return true;
}

export async function cancelImport(shopId: string, jobId: string) {
  await sweepStale(shopId);
  const job = await getJob(shopId, jobId);
  if (job.status === "completed" || job.status === "cancelled") return;
  // A check run can be cancelled (it notices and stops); a running import can't.
  const done =
    job.status !== "running" &&
    (await discard(job, ["uploaded", "ready", "previewing", "failed"]));
  if (!done) {
    throw new ImportError("This import is running and can't be cancelled.");
  }
}

async function failJob(jobId: string, error: unknown) {
  const reason =
    error instanceof ImportError
      ? error.message
      : "Something went wrong while importing. Nothing was changed.";
  if (!(error instanceof ImportError)) {
    console.error("import job failed", { jobId, error });
  }
  const { count } = await prisma.importJob.updateMany({
    where: { id: jobId, status: { in: ACTIVE } },
    data: { status: "failed", failureReason: reason, finishedAt: new Date() },
  });
  if (count === 1) await cleanUp(jobId);
}
