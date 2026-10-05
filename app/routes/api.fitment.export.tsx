// Filter data › Export: streams the rows as a CSV with the import's columns, so the file can be
// edited and imported again unchanged (specs/fitment-data.md › Export modal).
// POST /api/fitment/export { scope: all | selected | unmatched, ids?: string[] }
// POST rather than GET so a large selection doesn't have to fit in a URL.
import type { ActionFunctionArgs } from "react-router";
import { Readable } from "node:stream";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import {
  countExport,
  exportRows,
  listRowFields,
  rowIdsSchema,
} from "../models/fitment-row.server";
import { exportHeader, exportLine } from "../services/fitment/rows";

const exportSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all") }),
  z.object({ scope: z.literal("unmatched") }),
  z.object({ scope: z.literal("selected"), ids: rowIdsSchema }),
]);

const BOM = String.fromCharCode(0xfeff);

const FILE_NAMES = {
  all: "filter-data.csv",
  selected: "filter-data-selected.csv",
  unmatched: "filter-data-unlinked.csv",
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const parsed = exportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid export." }, { status: 400 });
  }
  const input = parsed.data;
  const ids = input.scope === "selected" ? input.ids : [];
  const [fields, count] = await Promise.all([
    listRowFields(shop.id),
    countExport(shop.id, input.scope, ids),
  ]);

  async function* lines() {
    // BOM so spreadsheet apps read the file as UTF-8; the import strips it.
    yield Buffer.from(BOM + exportHeader(fields));
    try {
      for await (const batch of exportRows(shop.id, input.scope, ids)) {
        yield Buffer.from(batch.map((row) => exportLine(fields, row)).join(""));
      }
    } catch (error) {
      // The 200 is already sent: the browser sees a broken download and shows an error toast.
      console.error("filter-data: export failed", {
        shop: session.shop,
        scope: input.scope,
        error,
      });
      throw error;
    }
  }

  const name = FILE_NAMES[input.scope];
  return new Response(
    Readable.toWeb(Readable.from(lines())) as ReadableStream,
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "X-Row-Count": String(count),
        "Cache-Control": "private, no-store",
      },
    },
  );
};
