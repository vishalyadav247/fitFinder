// The store's product tags for the Results page tab's filter groups: the tags of its active
// products with how many products have each, optionally searched. Scoped by shop.
import { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import { likePattern } from "../../models/fitment-row.server";

/** Tags listed per search: most products first. */
export const STORE_TAGS_LIMIT = 100;

export interface StoreTag {
  tag: string;
  products: number;
}

export async function storeTags(
  shopId: string,
  query: string,
): Promise<StoreTag[]> {
  const q = query.trim().slice(0, 100);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
    return tx.$queryRaw<StoreTag[]>`
      SELECT (array_agg(t ORDER BY t ~ '^[[:upper:]]' DESC, t))[1] AS tag, count(DISTINCT p.product_id)::int AS products
      FROM catalog_products p, unnest(p.tags) t
      WHERE p.shop_id = ${shopId} AND p.status = 'ACTIVE'
        ${q ? Prisma.sql`AND t ILIKE ${likePattern(q)}` : Prisma.empty}
      GROUP BY lower(t)
      ORDER BY products DESC, lower(t)
      LIMIT ${STORE_TAGS_LIMIT}`;
  });
}
