// Streams a CSV upload: plain or gzip (magic bytes), UTF-8 or Windows-1252 (common for Excel
// exports with ä, ö, ü), comma / semicolon / tab / pipe delimited. Rows come out as string arrays
// with their line number, without loading the file into memory.
import { createGunzip } from "node:zlib";
import { PassThrough, Readable, Transform } from "node:stream";
import { parse } from "csv-parse";

export const MAX_COLUMNS = 500;
const SNIFF_BYTES = 64 * 1024;

export interface CsvRecord {
  line: number;
  cells: string[];
}

export interface OpenedCsv {
  delimiter: string;
  encoding: "utf-8" | "windows-1252";
  records: AsyncIterable<CsvRecord>;
  /** Stops reading (e.g. after the preview rows). */
  close(): void;
}

/** Peeks at the start of a stream and returns a new stream that still yields every byte. */
async function peek(source: Readable, bytes: number) {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  let length = 0;
  source.pause();
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      length += chunk.length;
      if (length >= bytes) done();
    };
    const done = () => {
      source.off("data", onData);
      source.off("end", done);
      source.off("error", reject);
      source.pause();
      resolve();
    };
    source.on("data", onData);
    source.once("end", done);
    source.once("error", reject);
    source.resume();
  });
  const prefix = Buffer.concat(chunks);
  out.write(prefix);
  source.on("error", (e) => out.destroy(e));
  source.pipe(out);
  return { prefix, stream: out as Readable };
}

export function isGzip(prefix: Buffer) {
  return prefix.length >= 2 && prefix[0] === 0x1f && prefix[1] === 0x8b;
}

/** True when the bytes are valid UTF-8 (ignoring a sequence cut off at the end). */
export function looksUtf8(sample: Buffer): boolean {
  const cut = Math.max(0, sample.length - 3);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample.subarray(0, cut));
    return true;
  } catch {
    return false;
  }
}

/** Most frequent delimiter in the first line, ignoring quoted parts. */
export function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const unquoted = firstLine.replace(/"[^"]*"/g, "");
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const c of candidates) {
    const count = unquoted.split(c).length - 1;
    if (count > bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
}

/** Most bytes a file may have once unpacked (a small .gz can expand enormously). */
export const MAX_UNPACKED_BYTES = 2 * 1024 * 1024 * 1024;

/** The file isn't valid UTF-8 after all (only the first 64 KB were sniffed). */
export class CsvEncodingError extends Error {
  constructor() {
    super("The file isn't valid UTF-8");
    this.name = "CsvEncodingError";
  }
}

export class CsvTooLargeError extends Error {
  constructor() {
    super("The file is too large once unpacked");
    this.name = "CsvTooLargeError";
  }
}

/** Decodes text; UTF-8 strictly (errors instead of replacement characters); caps the bytes. */
function decoder(encoding: string, maxBytes: number) {
  const strict = encoding === "utf-8";
  const d = new TextDecoder(encoding, { fatal: strict });
  let bytes = 0;
  const decode = (chunk?: Buffer) => {
    try {
      return chunk ? d.decode(chunk, { stream: true }) : d.decode();
    } catch {
      throw new CsvEncodingError();
    }
  };
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > maxBytes) return cb(new CsvTooLargeError());
      try {
        cb(null, decode(chunk));
      } catch (error) {
        cb(error as Error);
      }
    },
    flush(cb) {
      try {
        cb(null, decode());
      } catch (error) {
        cb(error as Error);
      }
    },
  });
}

export async function openCsv(
  source: Readable,
  options: {
    encoding?: "utf-8" | "windows-1252";
    maxBytes?: number;
  } = {},
): Promise<OpenedCsv> {
  let { prefix, stream } = await peek(source, 2);
  if (isGzip(prefix)) {
    const gunzip = createGunzip();
    stream.on("error", (e) => gunzip.destroy(e));
    stream = stream.pipe(gunzip);
  }
  ({ prefix, stream } = await peek(stream, SNIFF_BYTES));

  const encoding =
    options.encoding ?? (looksUtf8(prefix) ? "utf-8" : "windows-1252");
  const sampleText = new TextDecoder(encoding)
    .decode(prefix)
    .replace(/^\ufeff/, "");
  const delimiter = sniffDelimiter(sampleText);

  const text = stream.pipe(
    decoder(encoding, options.maxBytes ?? MAX_UNPACKED_BYTES),
  );
  stream.on("error", (e) => text.destroy(e));
  const parser = parse({
    delimiter,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    info: true,
    max_record_size: 1024 * 1024,
  });
  text.on("error", (e) => parser.destroy(e));
  text.pipe(parser);

  async function* records(): AsyncIterable<CsvRecord> {
    for await (const item of parser as AsyncIterable<{
      record: string[];
      info: { lines: number };
    }>) {
      yield {
        line: item.info.lines,
        cells: item.record.slice(0, MAX_COLUMNS),
      };
    }
  }

  return {
    delimiter,
    encoding,
    records: records(),
    close() {
      parser.destroy();
      text.destroy();
      stream.destroy();
      source.destroy();
    },
  };
}

export interface CsvPreview {
  delimiter: string;
  encoding: string;
  /** First row (column titles) and up to `rows` rows after it. */
  firstRow: string[];
  sampleRows: string[][];
}

/** Reads the first row and the next few rows, then stops. */
export async function readPreview(
  source: Readable,
  rows = 3,
): Promise<CsvPreview> {
  const csv = await openCsv(source);
  let firstRow: string[] | null = null;
  const sampleRows: string[][] = [];
  try {
    for await (const r of csv.records) {
      if (!firstRow) firstRow = r.cells;
      else sampleRows.push(r.cells);
      if (sampleRows.length >= rows) break;
    }
  } finally {
    csv.close();
  }
  return {
    delimiter: csv.delimiter,
    encoding: csv.encoding,
    firstRow: firstRow ?? [],
    sampleRows,
  };
}

/** The stream decompressed when it starts with gzip magic bytes, else unchanged. */
export async function gunzipIfNeeded(source: Readable): Promise<Readable> {
  const { prefix, stream } = await peek(source, 2);
  if (!isGzip(prefix)) return stream;
  const gunzip = createGunzip();
  stream.on("error", (e) => gunzip.destroy(e));
  return stream.pipe(gunzip);
}
