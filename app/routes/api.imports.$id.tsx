// One import: status (polled while a job runs), save mapping (→ check run), start, cancel.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { listFields } from "../models/search-field.server";
import {
  ImportError,
  cancelImport,
  getJob,
  saveMapping,
  startRun,
  undoMapping,
  undoStart,
} from "../services/import/pipeline.server";
import { jobView } from "../services/import/view.server";
import { QUEUES, enqueue } from "../services/jobs.server";

async function view(shopId: string, jobId: string) {
  const [job, fields] = await Promise.all([
    getJob(shopId, jobId),
    listFields(shopId),
  ]);
  return jobView(job, fields);
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  try {
    return Response.json({ job: await view(shop.id, params.id ?? "") });
  } catch (error) {
    if (error instanceof ImportError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
};

const input = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("map"),
    choices: z.array(z.string().max(100)).max(500),
    hasHeader: z.boolean(),
    lookForSkus: z.boolean(),
    mode: z.enum(["upsert", "replace", "delete"]),
  }),
  z.object({ intent: z.literal("run") }),
  z.object({ intent: z.literal("cancel") }),
]);

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const jobId = params.id ?? "";
  const parsed = input.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "That couldn't be saved." }, { status: 400 });
  }

  try {
    const body = parsed.data;
    if (body.intent === "map") {
      const attempt = await saveMapping(shop.id, jobId, body);
      // If the job can't be queued, go back a step so the shop isn't stuck.
      await enqueue(QUEUES.importPreview, { jobId, attempt }).catch(
        async (error) => {
          await undoMapping(jobId);
          throw error;
        },
      );
    } else if (body.intent === "run") {
      const attempt = await startRun(shop.id, jobId);
      await enqueue(QUEUES.importRun, { jobId, attempt }).catch(
        async (error) => {
          await undoStart(jobId);
          throw error;
        },
      );
    } else {
      await cancelImport(shop.id, jobId);
    }
    return Response.json({ job: await view(shop.id, jobId) });
  } catch (error) {
    if (error instanceof ImportError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("import action failed", {
      shop: session.shop,
      jobId,
      intent: parsed.data.intent,
      error,
    });
    return Response.json(
      { error: "That couldn't be done. Try again." },
      { status: 500 },
    );
  }
};
