// PUT /api/storefront-settings — the Storefront page's save bar sends every change at once:
// { intent: "save", settings: { key: JSON value }, heading? }. Also { intent: "setting", key,
// value } and { intent: "heading", value } (one change), and { intent: "publish" } (Try again after
// a failed publish). Every value is checked before anything is written; after a write the new
// config is published to the theme (app metafield). Returns { ok, published }.
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import {
  saveHeading,
  saveSettings,
  SettingValueError,
  settingValue,
  storefrontIntentSchema,
} from "../models/storefront-settings.server";
import { publishWithOutcome } from "../services/storefront/sync.server";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const BAD = "That change couldn't be saved.";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  if (request.method !== "PUT") return json({ ok: false, error: BAD }, 405);
  const shop = await ensureShop(session.shop);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: BAD }, 400);
  }
  const parsed = storefrontIntentSchema.safeParse(body);
  if (!parsed.success) return json({ ok: false, error: BAD }, 400);
  const intent = parsed.data;

  try {
    if (intent.intent === "setting") {
      await saveSettings(shop.id, {
        [intent.key]: settingValue(intent.key, intent.value),
      });
    } else if (intent.intent === "heading") {
      await saveHeading(shop.id, intent.value);
    } else if (intent.intent === "save") {
      // Check every value first (throws SettingValueError), then write them in one go.
      const patch = Object.fromEntries(
        Object.entries(intent.settings).map(([key, value]) => [
          key,
          settingValue(key, value),
        ]),
      );
      if (Object.keys(patch).length) await saveSettings(shop.id, patch);
      if (intent.heading) await saveHeading(shop.id, intent.heading);
    }
  } catch (error) {
    if (error instanceof SettingValueError) {
      return json({ ok: false, error: error.message }, 400);
    }
    console.error("storefront: setting change failed", {
      shop: session.shop,
      intent: intent.intent,
      error,
    });
    return json({ ok: false, error: `${BAD} Try again.` }, 500);
  }

  try {
    // "pending": another request is publishing and picks this change up when it is done.
    const outcome = await publishWithOutcome(admin.graphql, shop.id);
    return json({ ok: true, published: outcome !== "behind" });
  } catch (error) {
    console.error("storefront: publish failed", { shop: session.shop, error });
    return json({ ok: true, published: false });
  }
};
