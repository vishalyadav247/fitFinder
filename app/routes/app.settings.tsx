// Settings: store type, what SpareFit stores, help.
// Spec: .claude/specs/settings.md · Prototype: .claude/design/scripts/screens/settings.js
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { getSearchConfig } from "../models/search-config.server";
import { keptFiles } from "../services/import/pipeline.server";
import { keptText } from "../components/import/ImportHistory";
import { STORE_TYPES } from "../services/store-types";
import { SectionTitle } from "../components/SectionTitle";
import { PageHeader } from "../components/PageHeader";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const config = await getSearchConfig(shop.id);
  if (!config) throw redirect("/app/onboarding");
  return {
    storeTypeLabel: STORE_TYPES[config.storeType].label,
    // How many imported files the plan keeps as backups.
    kept: await keptFiles(shop.id),
  };
};

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <s-page inlineSize="base">
      <PageHeader title="Settings" />
      <s-stack gap="base">
        <s-section accessibilityLabel="Store type">
          <SectionTitle icon="store" gap>
            Store type
          </SectionTitle>
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
          <SectionTitle icon="database" gap>
            Your data
          </SectionTitle>
          <s-stack gap="small-300">
            <s-text>
              SpareFit only stores what it needs to run your search. Your
              products in Shopify are never changed by the app.
            </s-text>
            <s-unordered-list>
              <s-list-item>
                <s-text type="strong">What we store:</s-text> your search
                fields, filter rows, product links, the {keptText(data.kept)}{" "}
                you imported (as backups) and the texts and settings you set in
                the app.
              </s-list-item>
              <s-list-item>
                <s-text type="strong">Shoppers:</s-text> a shopper&apos;s My
                Selection is saved in their own browser, not on our servers. We
                don&apos;t store names, emails or orders.
              </s-list-item>
              <s-list-item>
                <s-text type="strong">Backups:</s-text> you can download your{" "}
                {keptText(data.kept)} imported any time from Search setup ›
                Import history.
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
          <SectionTitle icon="question-circle" gap>
            Help
          </SectionTitle>
          <s-stack gap="small-300">
            <s-text>
              Need a hand? Chat with our support team right here in SpareFit.
            </s-text>
            <s-unordered-list>
              <s-list-item>
                Click the <s-text type="strong">chat button</s-text> on the
                right side of the screen to start a conversation.
              </s-list-item>
              <s-list-item>
                Ask us anything: setting up your search, importing fitment data,
                linking products, adding SpareFit to your theme or your plan.
              </s-list-item>
              <s-list-item>
                Your messages stay in the chat, so you can close it and pick up
                the conversation later.
              </s-list-item>
            </s-unordered-list>
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}
