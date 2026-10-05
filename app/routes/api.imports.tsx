// Import card, step 1: get an upload target, then create the import from the uploaded file.
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { listFields } from "../models/search-field.server";
import {
  MAX_UPLOAD_BYTES,
  newUploadKey,
  storage,
} from "../services/storage.server";
import { ImportError, createImport } from "../services/import/pipeline.server";
import { jobView } from "../services/import/view.server";

const MODE = z.enum(["upsert", "replace", "delete"]);
const input = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("upload-target"),
    fileName: z.string().min(1).max(255),
    size: z.coerce.number().int().min(1).max(MAX_UPLOAD_BYTES),
  }),
  z.object({
    intent: z.literal("create"),
    key: z.string().min(1).max(500),
    fileName: z.string().min(1).max(255),
    mode: MODE,
  }),
]);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const parsed = input.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: "Choose a .csv or .csv.gz file up to 100 MB." },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.intent === "upload-target") {
      const key = newUploadKey(shop.id, parsed.data.fileName);
      return Response.json({
        key,
        target: await storage().uploadTarget(key, parsed.data.size),
      });
    }
    const { job, choices } = await createImport(shop.id, parsed.data);
    const fields = await listFields(shop.id);
    return Response.json({ job: jobView(job, fields), choices });
  } catch (error) {
    if (error instanceof ImportError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("import create failed", { shop: session.shop, error });
    return Response.json(
      { error: "The file couldn't be read. Try again." },
      { status: 500 },
    );
  }
};
