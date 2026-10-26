// Settings: store type, custom CSS for the storefront, what SpareFit stores, help, feedback.
// Spec: .claude/specs/settings.md
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { z } from "zod";

import prisma from "../db.server";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { getSearchConfig } from "../models/search-config.server";
import { keptFiles } from "../services/import/pipeline.server";
import { keptText } from "../components/import/ImportHistory";
import { LockedSection } from "../components/LockedSection";
import { STORE_TYPES } from "../services/store-types";
import { getPlans, shopPlanView } from "../models/plan.server";
import { planWith } from "../services/billing";
import { saveSettings } from "../models/storefront-settings.server";
import { publishWithOutcome } from "../services/storefront/sync.server";
import { CUSTOM_CSS_KEY, storedCustomCss } from "../services/storefront/config";
import { CUSTOM_CSS_MAX, scopeCss } from "../services/storefront/custom-css";
import { SectionTitle } from "../components/SectionTitle";
import { PageHeader } from "../components/PageHeader";
import { Icon, type IconName } from "../components/Icon";
import {
  skipTabOnlyChanges,
  useUrlTab,
  type UrlTab,
} from "../components/url-tab";
import { writeReviewUrl } from "../services/review";

// Switching tabs only changes ?tab=: the page keeps its data.
export const shouldRevalidate = skipTabOnlyChanges;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const config = await getSearchConfig(shop.id);
  if (!config) throw redirect("/app/onboarding");
  const [kept, plan, plans, settings] = await Promise.all([
    keptFiles(shop.id),
    shopPlanView(shop.id),
    getPlans(),
    prisma.storefrontSettings.findUnique({
      where: { shopId: shop.id },
      select: { settings: true },
    }),
  ]);
  return {
    storeTypeLabel: STORE_TYPES[config.storeType].label,
    // How many imported files the plan keeps as backups.
    kept,
    customCss: storedCustomCss(settings?.settings),
    // When the shop's plan doesn't include Custom CSS: the plan that adds it ("" = none yet).
    cssLocked: plan.toggles.customCss
      ? null
      : (planWith(plans, "customCss")?.name ?? ""),
    // The App Store write-a-review link; null (section hidden) until the listing is live.
    reviewUrl: writeReviewUrl(process.env.APP_STORE_URL),
  };
};

const cssSchema = z.object({
  intent: z.literal("css"),
  css: z.string().max(CUSTOM_CSS_MAX),
});

type ActionResult =
  | {
      ok: true;
      dropped: string[];
      /** "published", "pending" (another publish picks it up) or "failed". */
      theme: "published" | "pending" | "failed";
    }
  | { ok: false; error: string };

/** Saves the custom CSS (as typed) and publishes the scoped version to the theme. */
export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const form = await request.formData();
  const parsed = cssSchema.safeParse({
    intent: form.get("intent"),
    css: String(form.get("css") ?? ""),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: `Use ${CUSTOM_CSS_MAX.toLocaleString("en-US")} characters or fewer.`,
    };
  }
  const plan = await shopPlanView(shop.id);
  if (!plan.toggles.customCss) {
    return { ok: false, error: "Your plan doesn't include custom CSS." };
  }
  const css = parsed.data.css.trim();
  try {
    await saveSettings(shop.id, { [CUSTOM_CSS_KEY]: css });
  } catch (error) {
    console.error("settings: custom CSS save failed", {
      shop: session.shop,
      error,
    });
    return { ok: false, error: "The CSS couldn't be saved. Try again." };
  }
  let theme: "published" | "pending" | "failed" = "failed";
  try {
    theme =
      (await publishWithOutcome(admin.graphql, shop.id)) === "behind"
        ? "pending"
        : "published";
  } catch (error) {
    console.error("settings: publish failed", { shop: session.shop, error });
  }
  return { ok: true, dropped: scopeCss(css).dropped, theme };
};

const SAVE_BAR = "settings-save-bar";

type Tab = "general" | "css";
// Each tab's name in the URL (?tab=); "css" still works for older links.
const URL_TABS: UrlTab<Tab>[] = [
  { key: "general", slug: "general" },
  { key: "css", slug: "custom-css", aliases: ["css"] },
];
const TABS: [Tab, string, IconName][] = [
  ["general", "General", "sliders"],
  ["css", "Custom CSS", "code"],
];

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  // The open tab is in the URL (?tab=general | custom-css), so a reload or a link keeps it.
  const [tab, showTab] = useUrlTab(URL_TABS);
  const fetcher = useFetcher<typeof action>();
  const [css, setCss] = useState(data.customCss);
  const [savedCss, setSavedCss] = useState(data.customCss);
  const [dropped, setDropped] = useState<string[]>([]);
  const saving = fetcher.state !== "idle";

  useEffect(() => {
    const result = fetcher.data;
    if (!result || fetcher.state !== "idle") return;
    if (!result.ok) {
      shopify.toast.show(result.error, { isError: true });
      return;
    }
    setSavedCss(css.trim());
    setDropped(result.dropped);
    if (result.theme === "failed") {
      shopify.toast.show(
        "Custom CSS saved, but your theme couldn't be updated. Save again to retry.",
        { isError: true },
      );
    } else {
      shopify.toast.show(
        result.theme === "published"
          ? "Custom CSS saved"
          : "Custom CSS saved. Your theme gets it shortly.",
      );
    }
    // Only when a save finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);

  // Unsaved CSS opens the App Bridge save bar (Save / Discard), like the Storefront page.
  const dirty = data.cssLocked === null && css.trim() !== savedCss;
  const saveCss = () =>
    fetcher.submit({ intent: "css", css }, { method: "post" });
  const discardCss = () => setCss(savedCss);
  /** Leaving from inside the page (Change store type): ask first while the CSS is unsaved. */
  const leave = async (go: () => void) => {
    if (dirty) await shopify.saveBar.leaveConfirmation?.();
    go();
  };

  return (
    <s-page inlineSize="base">
      {/* App Bridge save bar: the primary button is Save, the other one Discard. */}
      <SaveBar id={SAVE_BAR} open={dirty} discardConfirmation>
        <button
          variant="primary"
          loading={saving ? "" : undefined}
          onClick={saveCss}
        >
          Save
        </button>
        <button disabled={saving} onClick={discardCss}>
          Discard
        </button>
      </SaveBar>
      <PageHeader title="Settings" />
      <s-stack gap="base">
        <div className="sp-tabs" role="tablist" aria-label="Settings">
          {TABS.map(([k, label, icon]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => showTab(k)}
            >
              <Icon name={icon} size={16} />
              {label}
            </button>
          ))}
        </div>
        {tab === "general" && (
          <>
            <s-section accessibilityLabel="Store type">
              <SectionTitle icon="store" gap>
                Store type
              </SectionTitle>
              <s-grid
                gridTemplateColumns="1fr auto"
                gap="base"
                alignItems="center"
              >
                <s-stack gap="none">
                  <s-text type="strong">{data.storeTypeLabel}</s-text>
                  <s-text color="subdued">
                    Sets the starting fields and wording. Fields stay fully
                    editable.
                  </s-text>
                </s-stack>
                <s-button
                  icon="store"
                  onClick={() => leave(() => navigate("/app/onboarding"))}
                >
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
                    fields, filter rows, product links,{" "}
                    {data.kept > 0 &&
                      `the ${keptText(data.kept)} you imported (as backups), `}
                    and the texts and settings you set in the app.
                  </s-list-item>
                  <s-list-item>
                    <s-text type="strong">Shoppers:</s-text> a shopper&apos;s My
                    Selection is saved in their own browser, not on our servers.
                    We don&apos;t store names, emails or orders.
                  </s-list-item>
                  <s-list-item>
                    <s-text type="strong">Backups:</s-text>{" "}
                    {data.kept > 0
                      ? `you can download your ${keptText(data.kept)} imported any time from Filter data › Import › Import history.`
                      : "your plan doesn't include import backups."}
                  </s-list-item>
                  <s-list-item>
                    <s-text type="strong">If you uninstall:</s-text> the search
                    disappears from your store straight away. Your data is kept
                    for 30 days in case you reinstall, then deleted for good.
                  </s-list-item>
                  <s-list-item>
                    <s-text type="strong">Privacy requests:</s-text> customer
                    and shop data requests from Shopify (GDPR) are handled
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
                  Need a hand? Chat with our support team right here in
                  SpareFit.
                </s-text>
                <s-unordered-list>
                  <s-list-item>
                    Click the <s-text type="strong">chat button</s-text> on the
                    right side of the screen to start a conversation.
                  </s-list-item>
                  <s-list-item>
                    Ask us anything: setting up your search, importing fitment
                    data, linking products, adding SpareFit to your theme or
                    your plan.
                  </s-list-item>
                  <s-list-item>
                    Your messages stay in the chat, so you can close it and pick
                    up the conversation later.
                  </s-list-item>
                </s-unordered-list>
              </s-stack>
            </s-section>

            {data.reviewUrl && (
              <s-section accessibilityLabel="Feedback">
                <SectionTitle icon="star" gap>
                  Feedback
                </SectionTitle>
                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="base"
                  alignItems="center"
                >
                  <s-text color="subdued">
                    We value your feedback! It helps us make SpareFit better.
                    Let us know how we&apos;re doing.
                  </s-text>
                  {/* A new tab: the App Store can't open inside the admin's frame. */}
                  <s-button icon="star" href={data.reviewUrl} target="_blank">
                    Write a review
                  </s-button>
                </s-grid>
              </s-section>
            )}
          </>
        )}
        {tab === "css" && (
          <s-section accessibilityLabel="Custom CSS">
            <SectionTitle icon="code" gap>
              Custom CSS
            </SectionTitle>
            <s-stack gap="base">
              <s-text color="subdued">
                Small style changes for SpareFit on your store: the search
                widget, Fits badge, fitment table and My Selection button. Your
                CSS only applies to SpareFit, so it can&apos;t change the rest
                of your theme.
              </s-text>
              {dropped.length > 0 && (
                <s-banner
                  tone="warning"
                  heading="Some of your CSS was left out"
                  dismissible
                  onDismiss={() => setDropped([])}
                >
                  {`Not used on your store: ${dropped.join(", ")}. Only rules for SpareFit's classes, @media, @supports and @container work here.`}
                </s-banner>
              )}
              {data.cssLocked !== null ? (
                <LockedSection
                  plan={data.cssLocked}
                  feature="Custom CSS"
                  text="Style SpareFit on your store with your own CSS."
                >
                  <s-text-area
                    label="CSS"
                    rows={10}
                    maxLength={CUSTOM_CSS_MAX}
                    value={css}
                    disabled={data.cssLocked !== null}
                    placeholder={
                      ".sp-sfw__go {\n  text-transform: uppercase;\n}"
                    }
                    details={`Up to ${CUSTOM_CSS_MAX.toLocaleString("en-US")} characters. @import, @font-face and other global rules are left out.`}
                    onInput={(e) => setCss(e.currentTarget.value)}
                  />
                </LockedSection>
              ) : (
                <s-text-area
                  label="CSS"
                  rows={10}
                  maxLength={CUSTOM_CSS_MAX}
                  value={css}
                  disabled={data.cssLocked !== null}
                  placeholder={".sp-sfw__go {\n  text-transform: uppercase;\n}"}
                  details={`Up to ${CUSTOM_CSS_MAX.toLocaleString("en-US")} characters. @import, @font-face and other global rules are left out.`}
                  onInput={(e) => setCss(e.currentTarget.value)}
                />
              )}
            </s-stack>
          </s-section>
        )}
      </s-stack>
    </s-page>
  );
}
