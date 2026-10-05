// File storage for import uploads and reports. Local folder in development, Cloudflare R2
// (S3-compatible) in production: STORAGE_DRIVER=r2 with R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY, R2_BUCKET. Keys look like "imports/{shopId}/{uuid}/{name}".
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { S3Client } from "@aws-sdk/client-s3";

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export interface UploadTarget {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
}

export interface Storage {
  /** Where the browser PUTs the file (a presigned URL, or our own upload route). */
  /** `size` is signed into presigned URLs, so a bigger body is refused. */
  uploadTarget(key: string, size: number): Promise<UploadTarget>;
  put(key: string, body: Readable | Buffer | string): Promise<void>;
  get(key: string): Promise<Readable>;
  /** Size in bytes, or null when the object doesn't exist. */
  size(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

export function assertSafeKey(key: string): string {
  if (!KEY_PATTERN.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error("Invalid storage key");
  }
  return key;
}

/** Storage key for a new upload of a shop; the file name is kept readable but safe. */
export function newUploadKey(shopId: string, fileName: string): string {
  const safeName =
    fileName
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[-.]+/, "")
      .slice(-100) || "file.csv";
  return `imports/${shopId}/${crypto.randomUUID()}/${safeName}`;
}

export function keyBelongsToShop(key: string, shopId: string): boolean {
  return (
    key.startsWith(`imports/${shopId}/`) &&
    KEY_PATTERN.test(key) &&
    !key.includes("..") &&
    !key.includes("//")
  );
}

class LocalStorage implements Storage {
  constructor(private root: string) {}

  private file(key: string) {
    return path.join(this.root, ...assertSafeKey(key).split("/"));
  }

  async uploadTarget(key: string): Promise<UploadTarget> {
    return {
      url: `/api/uploads?key=${encodeURIComponent(assertSafeKey(key))}`,
      method: "PUT",
      headers: {},
    };
  }

  async put(key: string, body: Readable | Buffer | string) {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    const source =
      body instanceof Readable ? body : Readable.from([Buffer.from(body)]);
    await pipeline(source, createWriteStream(file));
  }

  async get(key: string) {
    return createReadStream(this.file(key));
  }

  async size(key: string) {
    try {
      return (await stat(this.file(key))).size;
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}

// The AWS SDK is loaded only when R2 is used.
class R2Storage implements Storage {
  private client: Promise<S3Client>;
  private sdk = import("@aws-sdk/client-s3");

  constructor(
    accountId: string,
    accessKeyId: string,
    secretAccessKey: string,
    private bucket: string,
  ) {
    this.client = this.sdk.then(
      ({ S3Client }) =>
        new S3Client({
          region: "auto",
          endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
          credentials: { accessKeyId, secretAccessKey },
        }),
    );
  }

  async uploadTarget(key: string, size: number): Promise<UploadTarget> {
    const [{ PutObjectCommand }, { getSignedUrl }, client] = await Promise.all([
      this.sdk,
      import("@aws-sdk/s3-request-presigner"),
      this.client,
    ]);
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: assertSafeKey(key),
        ContentLength: size,
      }),
      { expiresIn: 15 * 60, signableHeaders: new Set(["content-length"]) },
    );
    return { url, method: "PUT", headers: {} };
  }

  async put(key: string, body: Readable | Buffer | string) {
    const [{ PutObjectCommand }, client] = await Promise.all([
      this.sdk,
      this.client,
    ]);
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: assertSafeKey(key),
        Body: body,
      }),
    );
  }

  async get(key: string) {
    const [{ GetObjectCommand }, client] = await Promise.all([
      this.sdk,
      this.client,
    ]);
    const res = await client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: assertSafeKey(key) }),
    );
    return res.Body as Readable;
  }

  async size(key: string) {
    const [{ HeadObjectCommand }, client] = await Promise.all([
      this.sdk,
      this.client,
    ]);
    try {
      const res = await client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: assertSafeKey(key) }),
      );
      return res.ContentLength ?? null;
    } catch (error) {
      // Only "not found" means the object is missing; auth or network errors are real errors.
      const e = error as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404)
        return null;
      throw error;
    }
  }

  async delete(key: string) {
    const [{ DeleteObjectCommand }, client] = await Promise.all([
      this.sdk,
      this.client,
    ]);
    await client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: assertSafeKey(key) }),
    );
  }
}

let instance: Storage | undefined;

export function storage(): Storage {
  if (instance) return instance;
  if (process.env.STORAGE_DRIVER === "r2") {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } =
      process.env;
    if (
      !R2_ACCOUNT_ID ||
      !R2_ACCESS_KEY_ID ||
      !R2_SECRET_ACCESS_KEY ||
      !R2_BUCKET
    ) {
      throw new Error("STORAGE_DRIVER=r2 needs the R2_* environment variables");
    }
    instance = new R2Storage(
      R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY,
      R2_BUCKET,
    );
  } else {
    instance = new LocalStorage(
      path.resolve(process.env.STORAGE_DIR ?? ".data/storage"),
    );
  }
  return instance;
}

/** For tests: use a given storage. */
export function setStorageForTests(s: Storage | undefined) {
  instance = s;
}

export { LocalStorage };
