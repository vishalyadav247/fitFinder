// Download of an import's original file (Import history › Backup › Download), or its report
// with ?report=1. Fetched by the admin with the session token, then saved by the browser.
import type { LoaderFunctionArgs } from "react-router";
import { Readable } from "node:stream";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { ImportError, getJob } from "../services/import/pipeline.server";
import { storage } from "../services/storage.server";
import { gunzipIfNeeded } from "../services/import/csv-reader.server";

/** Printable ASCII only, without quotes or backslashes (header-safe). */
function asciiName(name: string) {
  return [...name]
    .map((c) => {
      const code = c.charCodeAt(0);
      return code < 32 || code > 126 || c === '"' || c === "\\" ? "_" : c;
    })
    .join("");
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const report = new URL(request.url).searchParams.get("report") === "1";

  let job;
  try {
    job = await getJob(shop.id, params.id ?? "");
  } catch (error) {
    if (error instanceof ImportError)
      return new Response(null, { status: 404 });
    throw error;
  }
  const key = report ? job.reportKey : job.fileKey;
  if (!key || (await storage().size(key)) === null) {
    return new Response(null, { status: 404 });
  }

  const name = report
    ? `${job.fileName.replace(/\.(csv|gz)+$/i, "")}-${job.mode === "delete" ? "not-found" : "errors"}.csv`
    : job.fileName;
  // Large .csv files are gzipped in the browser before upload; serve them as the CSV the
  // merchant chose. Files uploaded as .gz stay as they are.
  const stored = await storage().get(key);
  const file =
    report || /\.gz$/i.test(job.fileName)
      ? stored
      : await gunzipIfNeeded(stored);
  const body = Readable.toWeb(file) as ReadableStream;
  return new Response(body, {
    headers: {
      "Content-Type": report
        ? "text/csv; charset=utf-8"
        : "application/octet-stream",
      // ASCII fallback plus the UTF-8 name (RFC 6266), so any file name works.
      "Content-Disposition": `attachment; filename="${asciiName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
};
