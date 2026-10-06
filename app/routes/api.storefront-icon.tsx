// POST /api/storefront-icon (multipart, field "file") — the My Selection custom icon: checked
// (SVG or PNG, square, ≥ 48 px, ≤ 100 KB), uploaded to Shopify Files, saved as the icon and
// published to the theme. Returns { url } or { error }.
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { saveSettings } from "../models/storefront-settings.server";
import { checkIcon, ICON_MAX_BYTES } from "../services/storefront/icon";
import { uploadIcon } from "../services/storefront/icon-upload.server";
import { publishWithOutcome } from "../services/storefront/sync.server";

const json = (body: unknown, status = 200) => Response.json(body, { status });

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  if (request.method !== "POST") return json({ error: "bad_request" }, 405);
  // Refuse big bodies before reading them (the multipart wrapper adds a little).
  // A missing or odd Content-Length (chunked body) is refused too: formData() would buffer it all.
  const length = Number(request.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length) || length <= 0) {
    return json({ error: "Choose an SVG or PNG file." }, 411);
  }
  if (length > ICON_MAX_BYTES + 16 * 1024) {
    return json({ error: "The file is larger than 100 KB." }, 413);
  }
  const shop = await ensureShop(session.shop);

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return json({ error: "Choose an SVG or PNG file." }, 400);
  }
  if (!(file instanceof File)) {
    return json({ error: "Choose an SVG or PNG file." }, 400);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkIcon(bytes);
  if (!check.ok) return json({ error: check.error }, 400);

  let url: string;
  try {
    url = await uploadIcon(admin.graphql, bytes, check);
  } catch (error) {
    console.error("storefront: icon upload failed", {
      shop: session.shop,
      error,
    });
    return json({ error: "The icon couldn't be uploaded. Try again." }, 502);
  }
  try {
    await saveSettings(shop.id, { savedIcon: "custom", savedIconUrl: url });
  } catch (error) {
    console.error("storefront: saving the uploaded icon failed", {
      shop: session.shop,
      error,
    });
    return json({ error: "The icon couldn't be saved. Try again." }, 500);
  }
  let published = true;
  try {
    published = (await publishWithOutcome(admin.graphql, shop.id)) !== "behind";
  } catch (error) {
    published = false;
    console.error("storefront: publish after icon upload failed", {
      shop: session.shop,
      error,
    });
  }
  return json({ url, published });
};
