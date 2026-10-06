// Filter data › rows table: one page of rows, optionally searched (specs/fitment-data.md).
// GET /api/fitment?q=&page=&pageSize=  (session token; the admin fetches it as you type)
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import {
  DEFAULT_TABLE_PAGE_SIZE,
  TABLE_PAGE_SIZES,
} from "../components/table-paging";
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
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => (TABLE_PAGE_SIZES as readonly number[]).includes(n))
    .default(DEFAULT_TABLE_PAGE_SIZE),
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
