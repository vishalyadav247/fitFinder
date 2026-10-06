// Settings: store type, what FitFinder stores, help.
// Spec: .claude/specs/settings.md · Prototype: .claude/design/scripts/screens/settings.js
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { getSearchConfig } from "../models/search-config.server";
import { STORE_TYPES } from "../services/store-types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const config = await getSearchConfig(shop.id);
  if (!config) throw redirect("/app/onboarding");
  return {
    storeTypeLabel: STORE_TYPES[config.storeType].label,
    // Optional: set in the environment once support and docs exist.
    supportEmail: process.env.SUPPORT_EMAIL || null,
    helpCenterUrl: process.env.HELP_CENTER_URL || null,
  };
};

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page heading="Settings" inlineSize="base">
      <s-stack gap="base">
        <s-section accessibilityLabel="Store type">
          <h2 className="ff-sec-title ff-sec-gap">Store type</h2>
          <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
            <s-stack gap="none">
              <s-text type="strong">{data.storeTypeLabel}</s-text>
              <s-text color="subdued">
                Sets the starting fields and wording. Fields stay fully
                editable.
              </s-text>
            </s-stack>
            <s-button icon="store" onClick={() => navigate("/app/onboarding")}>
              Change
            </s-button>
          </s-grid>
        </s-section>

        <s-section accessibilityLabel="Your data">
          <h2 className="ff-sec-title ff-sec-gap">Your data</h2>
          <s-stack gap="small-300">
            <s-text>
              FitFinder only stores what it needs to run your search. Your
              products in Shopify are never changed by the app.
            </s-text>
            <s-unordered-list>
              <s-list-item>
                <s-text type="strong">What we store:</s-text> your search
                fields, filter rows, product links, the last 5 imported files
                (as backups) and the texts and settings you set in the app.
              </s-list-item>
              <s-list-item>
                <s-text type="strong">Shoppers:</s-text> a shopper&apos;s My
                Selection is saved in their own browser, not on our servers. We
                don&apos;t store names, emails or orders.
              </s-list-item>
              <s-list-item>
                <s-text type="strong">Backups:</s-text> you can download each of
                your last 5 imported files any time from Search setup › Import
                history.
              </s-list-item>
              <s-list-item>
                <s-text type="strong">If you uninstall:</s-text> the search
                disappears from your store straight away. Your data is kept for
                30 days in case you reinstall, then deleted for good.
              </s-list-item>
              <s-list-item>
                <s-text type="strong">Privacy requests:</s-text> customer and
                shop data requests from Shopify (GDPR) are handled
                automatically.
              </s-list-item>
            </s-unordered-list>
          </s-stack>
        </s-section>

        <s-section accessibilityLabel="Help">
          <h2 className="ff-sec-title ff-sec-gap">Help</h2>
          <s-stack direction="inline" gap="small-200">
            <s-button
              icon="email"
              disabled={!data.supportEmail}
              href={
                data.supportEmail ? `mailto:${data.supportEmail}` : undefined
              }
              target="_blank"
            >
              Contact support
            </s-button>
            <s-button
              icon="external"
              variant="tertiary"
              disabled={!data.helpCenterUrl}
              href={data.helpCenterUrl ?? undefined}
              target="_blank"
            >
              Help center
            </s-button>
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}
