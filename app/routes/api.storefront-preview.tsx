// GET /api/storefront-preview?path=options|results&… — the Storefront page's live previews run
// the real storefront scripts; their app proxy calls come here instead (admin session), with the
// same parameters as /apps/fitfinder/options and /results.
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { isComplete, parsePicks } from "../services/storefront/picks";
import { fieldOptions, shopSearch } from "../services/storefront/query.server";
import { previewResults } from "../services/storefront/preview.server";

const json = (body: unknown, status = 200) => Response.json(body, { status });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const search = await shopSearch(session.shop);
  if (!search) return json({ error: "not_found" }, 404);
  const params = new URL(request.url).searchParams;
  const picks = parsePicks(params, search.fields);
  if (!picks) return json({ error: "bad_request" }, 400);

  switch (params.get("path")) {
    case "options": {
      const index = search.fields.findIndex(
        (f) => f.id === params.get("field"),
      );
      if (index < 0) return json({ error: "bad_request" }, 400);
      return json({ options: await fieldOptions(search, index, picks) });
    }
    case "results": {
      if (!isComplete(picks, search.fields)) {
        return json({ titles: [], total: 0 });
      }
      return json(await previewResults(search, picks));
    }
    default:
      return json({ error: "bad_request" }, 400);
  }
};
