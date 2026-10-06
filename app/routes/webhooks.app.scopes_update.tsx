import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const Payload = z.object({ current: z.array(z.string()) });

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const parsed = Payload.safeParse(payload);
  if (!parsed.success) {
    console.error("scopes_update: unexpected payload", { shop });
    return new Response();
  }

  // updateMany: the session can be gone by the time a retried delivery arrives (uninstall or
  // purge in between); update() would throw and Shopify would keep retrying.
  if (session) {
    await db.session.updateMany({
      where: { id: session.id },
      data: { scope: parsed.data.current.toString() },
    });
  }
  return new Response();
};
