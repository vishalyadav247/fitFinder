// Browser side of the import card: upload, API calls, downloads. Same-origin fetches carry the
// session token automatically (App Bridge).
import type { ImportJobView } from "../../services/import/view.server";

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
// Plain CSVs above this are gzipped in the browser first (fitment files shrink ~8x).
const GZIP_ABOVE_BYTES = 1024 * 1024;

export type ApiResult<T> = T & { error?: string };

async function api<T>(url: string, body?: unknown): Promise<ApiResult<T>> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as ApiResult<T>;
  if (!res.ok && !json.error) json.error = "Something went wrong. Try again.";
  return json;
}

export function fileProblem(file: File): string | null {
  if (!/\.(csv|csv\.gz|gz)$/i.test(file.name)) {
    return "Choose a .csv or .csv.gz file.";
  }
  if (file.size > MAX_UPLOAD_BYTES) return "The file is larger than 100 MB.";
  if (file.size === 0) return "This file is empty.";
  return null;
}

async function maybeGzip(file: File): Promise<Blob> {
  const plainCsv = /\.csv$/i.test(file.name);
  if (
    !plainCsv ||
    file.size < GZIP_ABOVE_BYTES ||
    !("CompressionStream" in window)
  ) {
    return file;
  }
  const gz = file.stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(gz).blob();
}

/** Uploads the file and creates the import (step 1 → 2). */
export async function uploadAndCreate(
  file: File,
  mode: ImportJobView["mode"],
): Promise<ApiResult<{ job?: ImportJobView; choices?: string[] }>> {
  const body = await maybeGzip(file);
  const target = await api<{
    key?: string;
    target?: { url: string; method: string; headers: Record<string, string> };
  }>("/api/imports", {
    intent: "upload-target",
    fileName: file.name,
    size: body.size,
  });
  if (target.error || !target.key || !target.target) {
    return { error: target.error ?? "The upload couldn't start." };
  }
  const put = await fetch(target.target.url, {
    method: target.target.method,
    headers: target.target.headers,
    body,
  });
  if (!put.ok) {
    return {
      error:
        put.status === 413
          ? "The file is larger than 100 MB."
          : "The upload failed. Try again.",
    };
  }
  return api("/api/imports", {
    intent: "create",
    key: target.key,
    fileName: file.name,
    mode,
  });
}

export function getJob(id: string) {
  return api<{ job?: ImportJobView }>(`/api/imports/${id}`);
}

export function jobAction(
  id: string,
  body:
    | {
        intent: "map";
        choices: string[];
        hasHeader: boolean;
        lookForSkus: boolean;
        mode: ImportJobView["mode"];
      }
    | { intent: "run" }
    | { intent: "cancel" },
) {
  return api<{ job?: ImportJobView }>(`/api/imports/${id}`, body);
}

/** Cancels without waiting; used when leaving the page. */
export function cancelInBackground(id: string) {
  void fetch(`/api/imports/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "cancel" }),
    keepalive: true,
  }).catch(() => {});
}

/** Fetches a file with the session token and saves it. Returns false when it failed. */
export async function download(
  url: string,
  fallbackName: string,
): Promise<boolean> {
  const res = await fetch(url);
  if (!res.ok) return false;
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const name = disposition.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  saveBlob(await res.blob(), name);
  return true;
}

export function saveBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a); // some browsers only download from attached links
  a.click();
  a.remove();
  // Large files keep reading the blob after click(); revoke later.
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

/** CSV template: one column per field (a Year range as one "2015-2020" column) and Attachment. */
export function templateCsv(labels: string[]): Blob {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return new Blob([[...labels, "Attachment"].map(q).join(",") + "\r\n"], {
    type: "text/csv",
  });
}
