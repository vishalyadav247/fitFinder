// PUT target for uploads when files are stored locally (development). With R2 the browser uploads
// straight to a presigned URL instead. Session-token authenticated; a shop can only write its own keys.
import type { ActionFunctionArgs } from "react-router";
import { Readable, Transform } from "node:stream";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import {
  MAX_UPLOAD_BYTES,
  keyBelongsToShop,
  storage,
} from "../services/storage.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "PUT") return new Response(null, { status: 405 });
  if (process.env.STORAGE_DRIVER === "r2") {
    return new Response(null, { status: 404 });
  }
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);

  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!keyBelongsToShop(key, shop.id)) {
    return new Response("Invalid key", { status: 403 });
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES) {
    return new Response("The file is larger than 100 MB.", { status: 413 });
  }
  if (!request.body) return new Response("Empty upload", { status: 400 });

  // Count bytes as they arrive: Content-Length can be missing or wrong.
  let received = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      if (received > MAX_UPLOAD_BYTES) {
        cb(new Error("too large"));
      } else cb(null, chunk);
    },
  });
  try {
    // Forward source errors (client aborted the upload) so the write can't hang.
    const source = Readable.fromWeb(request.body as never);
    source.on("error", (error) => limit.destroy(error));
    await storage().put(key, source.pipe(limit));
  } catch {
    await storage()
      .delete(key)
      .catch(() => {});
    return new Response(
      received > MAX_UPLOAD_BYTES
        ? "The file is larger than 100 MB."
        : "The upload failed. Try again.",
      { status: received > MAX_UPLOAD_BYTES ? 413 : 400 },
    );
  }
  return new Response(null, { status: 204 });
};
