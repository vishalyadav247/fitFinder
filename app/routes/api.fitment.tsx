// Filter data › rows table: one page of rows, optionally searched (specs/fitment-data.md).
// GET /api/fitment?q=&page=  (session token; the admin fetches it as you type)
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import {
  FitmentRuleError,
  MAX_QUERY,
  listRows,
} from "../models/fitment-row.server";

const querySchema = z.object({
  q: z.string().max(MAX_QUERY).default(""),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) {
    return Response.json({ error: "Invalid search." }, { status: 400 });
  }
  try {
    return Response.json(await listRows(shop.id, parsed.data), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof FitmentRuleError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
};
