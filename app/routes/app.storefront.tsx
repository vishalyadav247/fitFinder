// Storefront: theme integration (app embed and blocks per theme, theme editor deep links) and the
// settings of the shopper-facing blocks with live previews. Changes collect in a draft (the
// previews follow it) behind the App Bridge save bar; Save sends them all at once and publishes
// the result to the theme (app metafield).
// Spec: .claude/specs/storefront.md
import { useCallback, useEffect, useRef, useState } from "react";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { getSearchConfig } from "../models/search-config.server";
import {
  loadStorefrontConfig,
  publishWithOutcome,
  storefrontConfigPublished,
} from "../services/storefront/sync.server";
import {
  listThemes,
  readThemeStatus,
} from "../services/storefront/themes.server";
import {
  editorLinks,
  isThemeAccessError,
  TABLE_CODE,
  themeLabel,
  type BlockKey,
  type ThemeItem,
  type ThemeStatusView,
} from "../services/storefront/themes";
import { previewSample } from "../services/storefront/preview.server";
import { PREVIEW_ASSETS } from "../components/storefront/preview-assets.server";
import { selectionLabel } from "../services/storefront/picks";
import { STORE_TYPES } from "../services/store-types";
import {
  EDITABLE_KEYS,
  type EditableKey,
  type StorefrontSettings,
} from "../services/storefront/settings";
import {
  SELECTION_HEIGHT,
  StorefrontPreview,
} from "../components/storefront/StorefrontPreview";
import styles from "../styles/storefront.css?url";
import { SectionTitle } from "../components/SectionTitle";
import { Icon, type IconName } from "../components/Icon";
import { PageHeader } from "../components/PageHeader";
import { getPlans, shopPlanView } from "../models/plan.server";
import { planWith } from "../services/billing";
import type { ToggleKey } from "../services/plan-features";
import { Option, Select } from "../components/Select";
import { ResultsPreview } from "../components/storefront/ResultsPreview";
import { TagPicker } from "../components/storefront/TagPicker";
import {
  skipTabOnlyChanges,
  useUrlTab,
  type UrlTab,
} from "../components/url-tab";
import { defaultPageTitle } from "../services/storefront/results-page";
import { resultsAdminData } from "../services/storefront/results-admin.server";
import {
  FILTER_LABEL_MAX,
  BADGE_LABEL_MAX,
  BADGE_SIZE_MAX,
  BADGE_SIZE_MIN,
  BADGE_TAG_COLORS,
  CARD_GAP_MAX,
  CART_TEXT_MAX,
  EMPTY_TEXT_MAX,
  SHAPE_RADIUS,
  type BadgeTag,
  type Shape,
  PAGE_WIDTH_MAX,
  PAGE_WIDTH_MIN,
  MAX_BADGE_TAGS,
  MAX_GROUP_TAGS,
  SAFE_LINK,
  MAX_FILTERS,
  maxRows,
  PAGE_TITLE_MAX,
  TITLE_SIZE_MAX,
  TITLE_SIZE_MIN,
  defaultResultsPage,
  newFilterId,
  SORTS,
  type ResultsFilter,
  type ResultsPageSettings,
} from "../services/storefront/results-settings";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

// Switching tabs only changes ?tab=: the page keeps its data (no new theme read).
export const shouldRevalidate = skipTabOnlyChanges;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin, redirect } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const searchConfig = await getSearchConfig(shop.id);
  // The layout redirects too, but child loaders run in parallel with it.
  if (!searchConfig) throw redirect("/app/onboarding");

  // The layout publishes too; publishing here as well tells the page whether the theme has the
  // latest settings (publishes are serialized per shop, so the second one is a no-op).
  let publishFailed = false;
  try {
    publishFailed =
      (await publishWithOutcome(admin.graphql, shop.id)) === "behind";
  } catch (error) {
    console.error("storefront: publish failed", { shop: session.shop, error });
    publishFailed = !(await storefrontConfigPublished(shop.id));
  }

  let themes: ThemeItem[] = [];
  let status: ThemeStatusView | null = null;
  // "access": the store hasn't granted read_themes yet (scopes added after it installed the app).
  let themesError: "access" | "other" | null = null;
  try {
    themes = await listThemes(admin.graphql);
    if (themes[0]) {
      status = await readThemeStatus(admin.graphql, shop.id, themes[0].id);
    }
  } catch (error) {
    console.error("storefront: themes read failed", {
      shop: session.shop,
      error,
    });
    themesError = isThemeAccessError(error) ? "access" : "other";
  }

  const config = (await loadStorefrontConfig(shop.id))!;
  const fieldTypes = config.fields.map((f) => ({
    id: f.id,
    type: f.type === "years" ? ("year_range" as const) : ("list" as const),
  }));
  const sample = await previewSample(shop.id, fieldTypes);
  const first = sample.selections[0];
  // Features the plan doesn't include: the plan that adds them ("Needs Growth plan").
  const [plan, plans, results] = await Promise.all([
    shopPlanView(shop.id),
    getPlans(),
    resultsAdminData(shop.id),
  ]);
  const needs = (key: ToggleKey) =>
    plan.toggles[key] ? null : (planWith(plans, key)?.name ?? "a higher");
  return {
    locked: {
      badge: needs("fitsBadge"),
      table: needs("fitmentTable"),
      garage: needs("mySelection"),
    },
    shop: session.shop,
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
    config,
    storeIcon: STORE_TYPES[searchConfig.storeType].icon,
    themes,
    status,
    themesError,
    publishFailed,
    sample,
    previewAssets: PREVIEW_ASSETS,
    results,
    exampleLabel: first
      ? selectionLabel(fieldTypes, new Map(Object.entries(first)))
      : "",
  };
};

type Tab = "theme" | "widget" | "results" | "badge" | "table" | "garage";
// Line icons (they follow the text colour), like the section titles.
// Each tab's name in the URL (?tab=); the short keys still work for older links.
const URL_TABS: UrlTab<Tab>[] = [
  { key: "theme", slug: "theme-integration", aliases: ["theme"] },
  { key: "widget", slug: "search-widget", aliases: ["widget"] },
  { key: "results", slug: "results-page", aliases: ["results"] },
  { key: "badge", slug: "fits-badge", aliases: ["badge"] },
  { key: "table", slug: "fitment-table", aliases: ["table"] },
  { key: "garage", slug: "my-selection", aliases: ["garage"] },
];
const TABS: [Tab, string, IconName][] = [
  ["theme", "Theme integration", "store"],
  ["widget", "Search widget", "search"],
  ["results", "Results page", "page"],
  ["badge", "Fits badge", "checkCircle"],
  ["table", "Fitment table", "table"],
  ["garage", "My Selection", "star"],
];

type SaveResult = { ok: boolean; published?: boolean; error?: string };

async function put(body: unknown): Promise<SaveResult> {
  try {
    const res = await fetch("/api/storefront-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as SaveResult;
  } catch {
    return { ok: false, error: "That change couldn't be saved. Try again." };
  }
}

const valueOf = (e: Event) =>
  String((e.currentTarget as HTMLInputElement).value ?? "");
const checkedOf = (e: Event) => !!(e.currentTarget as HTMLInputElement).checked;
const SAVE_BAR = "storefront-save-bar";
/** Settings edited in text fields: saved trimmed, and an emptied one keeps its saved text. */
const TEXT_KEYS = new Set<EditableKey>([
  "askText",
  "button",
  "fitsText",
  "garageName",
  "noFitLinkText",
  "noFitText",
  "resetText",
  "saveText",
  "tableEmptyText",
  "tableTitle",
]);
const open = (url: string) => window.open(url, "_blank", "noopener");
/** The Results page tab's side menu (?section=): four settings sections, then Preview. */
type RpSection = "page" | "grid" | "filters" | "cards";
// In the order they show on the page: the page, the filters, the grid, its cards.
const RP_SECTIONS: [RpSection, string][] = [
  ["page", "Page"],
  ["filters", "Filters"],
  ["grid", "Product grid"],
  ["cards", "Product cards"],
];
const RP_SECTION_TABS: UrlTab<RpSection>[] = [
  { key: "page", slug: "page" },
  { key: "grid", slug: "product-grid" },
  { key: "filters", slug: "filters" },
  { key: "cards", slug: "product-cards" },
];
/** The side menu's icons (components/Icon). */
const RP_ICON: Record<RpSection, IconName> = {
  page: "page",
  grid: "grid",
  filters: "sliders",
  cards: "product",
};
const FILTER_MODAL = "sp-rp-filter-modal";
const BADGE_MODAL = "sp-rp-badge-modal";
const BADGE_DELETE_MODAL = "sp-rp-badge-delete";
const RESULTS_PREVIEW_MODAL = "sp-rp-preview-modal";
const FILTER_DELETE_MODAL = "sp-rp-filter-delete";

export default function StorefrontPage() {
  const data = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const { config, sample } = data;

  // What the server has (saved) and the draft shown in the fields and previews (s, heading). The
  // save bar shows while they differ.
  const [saved, setSaved] = useState<StorefrontSettings>(config.s);
  const [s, setS] = useState<StorefrontSettings>(config.s);
  const [savedHeading, setSavedHeading] = useState(config.heading);
  const [heading, setHeading] = useState(config.heading);
  const [saving, setSaving] = useState(false);
  // Results page tab: its own document (filters and layout), in the same draft and save bar.
  // Over the defaults, so settings added later (e.g. filter layout) always have a value.
  const loadedRp = { ...defaultResultsPage(), ...data.results.settings };
  const [savedRp, setSavedRp] = useState<ResultsPageSettings>(loadedRp);
  const [rp, setRp] = useState<ResultsPageSettings>(loadedRp);
  const [publishFailed, setPublishFailed] = useState(data.publishFailed);
  const [tab, setTab] = useUrlTab(URL_TABS);
  const [rpSection, setRpSection] = useUrlTab(RP_SECTION_TABS, "page", {
    param: "section",
    active: tab === "results",
  });
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [iconBusy, setIconBusy] = useState(false);
  const [iconError, setIconError] = useState("");
  const picks = useRef<Record<string, string>>({});
  const onPicks = useCallback((p: Record<string, string>) => {
    picks.current = p;
  }, []);
  const tabsRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------- themes
  const [themeId, setThemeId] = useState(data.themes[0]?.id ?? "");
  const [status, setStatus] = useState<ThemeStatusView | null>(data.status);
  const [statusError, setStatusError] = useState(false);
  // The live theme's status stays known while a draft theme is selected (critical banner).
  const liveId = data.themes.find((t) => t.role === "MAIN")?.id;
  const [liveStatus, setLiveStatus] = useState<ThemeStatusView | null>(
    data.themes[0]?.role === "MAIN" ? data.status : null,
  );
  const themeRef = useRef(themeId);
  themeRef.current = themeId;
  const theme = data.themes.find((t) => t.id === themeId);
  const links = editorLinks(data.shop, themeId, data.apiKey);

  const loadStatus = useCallback(
    async (id: string) => {
      if (!id) return;
      setStatusError(false);
      try {
        const res = await fetch(`/api/themes/${id}`);
        const body = (await res.json()) as {
          status?: ThemeStatusView;
          error?: string;
        };
        if (themeRef.current !== id) return;
        if (!res.ok || !body.status) throw new Error(body.error);
        if (id === liveId) setLiveStatus(body.status);
        setStatus(body.status);
      } catch {
        if (themeRef.current === id) setStatusError(true);
      }
    },
    [liveId],
  );

  // Back from the theme editor (another tab): read the theme again.
  useEffect(() => {
    let last = 0;
    const onFocus = () => {
      if (Date.now() - last < 2000) return;
      last = Date.now();
      loadStatus(themeRef.current);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadStatus]);

  const pickTheme = (id: string) => {
    if (!id || id === themeId) return;
    setThemeId(id);
    setStatus(null);
    loadStatus(id);
  };

  const embed = !!status?.embedOn;

  // ---------------------------------------------------------------- saving
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  const changedKeys = EDITABLE_KEYS.filter((k) => !same(s[k], saved[k]));
  const rpChanged = !same(rp, savedRp);
  const dirty =
    changedKeys.length > 0 || heading.trim() !== savedHeading || rpChanged;

  /** A change goes into the draft; Save sends it. */
  const save = <K extends EditableKey>(key: K, value: StorefrontSettings[K]) =>
    setS((cur) => ({ ...cur, [key]: value }));

  /** Text fields: the draft (and the preview) follow typing. */
  const textProps = (key: EditableKey & keyof StorefrontSettings) => ({
    value: String(s[key]),
    onInput: (e: Event) => save(key, valueOf(e) as never),
  });

  const saveAll = async () => {
    // What this Save sends: the draft as it is now (edits made while it runs stay in the draft).
    const sent = s;
    const sentHeading = heading;
    const sentRp = rp;
    const rpSent = rpChanged;
    // Texts are trimmed; an emptied one keeps its saved text (it isn't sent).
    const applied: Partial<Record<EditableKey, unknown>> = {};
    const settings: Record<string, string> = {};
    for (const key of changedKeys) {
      let value: unknown = sent[key];
      if (TEXT_KEYS.has(key) && typeof value === "string") {
        value = value.trim();
        if (!value) {
          applied[key] = saved[key];
          continue;
        }
      }
      applied[key] = value;
      settings[key] = JSON.stringify(value);
    }
    const newHeading = sentHeading.trim() || savedHeading;
    setSaving(true);
    const r = await put({
      intent: "save",
      settings,
      ...(newHeading !== savedHeading ? { heading: newHeading } : {}),
      ...(rpSent ? { resultsPage: sentRp } : {}),
    });
    setSaving(false);
    if (!r.ok) {
      shopify.toast.show(r.error ?? "Your changes couldn't be saved.", {
        isError: true,
      });
      return;
    }
    // Saved now: what was sent. The draft takes it only where nothing changed since Save was
    // clicked (an icon uploaded meanwhile keeps its own saved values: functional updates).
    setSaved((cur) => ({ ...cur, ...applied }) as StorefrontSettings);
    setS((cur) => {
      const next = { ...cur } as Record<string, unknown>;
      for (const [key, value] of Object.entries(applied)) {
        if (same(cur[key as EditableKey], sent[key as EditableKey])) {
          next[key] = value;
        }
      }
      return next as unknown as StorefrontSettings;
    });
    setSavedHeading(newHeading);
    setHeading((cur) => (cur === sentHeading ? newHeading : cur));
    if (rpSent) setSavedRp(sentRp);
    setPublishFailed(r.published === false);
    shopify.toast.show("Settings saved");
  };

  const discard = () => {
    setS(saved);
    setHeading(savedHeading);
    setRp(savedRp);
  };

  /** Leaving the page from inside it: ask first while there are unsaved changes. */
  const leave = async (go: () => void) => {
    // Resolves when the merchant confirms (or no save bar is open); staying never resolves.
    if (dirty) await shopify.saveBar.leaveConfirmation?.();
    go();
  };

  const retryPublish = async () => {
    const r = await put({ intent: "publish" });
    if (r.ok && r.published) {
      setPublishFailed(false);
      shopify.toast.show("Theme updated");
    } else {
      shopify.toast.show("The theme couldn't be updated. Try again later.", {
        isError: true,
      });
    }
  };

  const uploadIcon = async (file: File | undefined) => {
    if (!file) return;
    setIconError("");
    setIconBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/storefront-icon", {
        method: "POST",
        body: form,
      });
      const body = (await res.json()) as {
        url?: string;
        published?: boolean;
        error?: string;
      };
      if (!res.ok || !body.url) {
        setIconError(body.error ?? "The icon couldn't be uploaded.");
        return;
      }
      // The upload is saved right away (a file, not a draft change).
      const icon = { savedIcon: "custom" as const, savedIconUrl: body.url! };
      setSaved((cur) => ({ ...cur, ...icon }));
      setS((cur) => ({ ...cur, ...icon }));
      setPublishFailed(body.published === false);
      shopify.toast.show("Icon uploaded");
    } catch {
      setIconError("The icon couldn't be uploaded. Try again.");
    } finally {
      setIconBusy(false);
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(TABLE_CODE);
      shopify.toast.show(`Copied ${TABLE_CODE}`);
    } catch {
      shopify.toast.show("Couldn't copy. Select the code and copy it.", {
        isError: true,
      });
    }
  };

  const showTab = (t: Tab) => {
    setTab(t);
    requestAnimationFrame(() =>
      tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  const openEditor = (url: string, message?: string) => {
    open(url);
    if (message) shopify.toast.show(message);
  };

  // ---------------------------------------------------------------- preview config
  const live: StorefrontSettings = s;
  const previewConfig = {
    ...config,
    heading,
    s: live,
  };
  const things = config.things;
  const noun = config.noun;
  const yearField = config.fields.find((f) => f.type === "years");
  const shownCols = config.fields.filter((f) => !s.tableHide[f.id]);
  const inTabs = s.tablePlace === "tabs";

  // ---------------------------------------------------------------- theme integration
  const blockStatus = (key: BlockKey) => status?.blocks[key];
  type Row = {
    name: string;
    type: string;
    where: string;
    kind: "block" | "code" | "embed";
    key?: BlockKey;
  };
  const rows: Row[] = [
    {
      name: "Search section",
      type: "Section",
      where: "Home, collection, product or any other page",
      kind: "block",
      key: "search",
    },
    {
      name: "Fits badge",
      type: "App block",
      where: "Product page",
      kind: "block",
      key: "badge",
    },
    inTabs
      ? {
          name: "Fitment table",
          // Both ways are offered (Fitment table tab › Where to show it).
          type: "App block / Shortcode",
          where: "Product page",
          kind: "code",
        }
      : {
          name: "Fitment table",
          type: "App block / Shortcode",
          where: "Product page",
          kind: "block",
          key: "table",
        },
    {
      name: "My Selection",
      type: "App embed",
      where: "Floating button on every page",
      kind: "embed",
    },
  ];

  const lockOf = (row: Row) =>
    row.kind === "embed"
      ? data.locked.garage
      : row.name === "Fitment table"
        ? data.locked.table
        : row.key === "badge"
          ? data.locked.badge
          : null;

  const statusCell = (row: Row) => {
    const lock = lockOf(row);
    if (lock) {
      return <s-badge tone="info">{`Needs ${lock} plan`}</s-badge>;
    }
    if (data.themesError) return <s-badge>Not checked</s-badge>;
    if (!themeId) return <s-text color="subdued">No theme</s-text>;
    if (!status) {
      return statusError ? (
        <s-button
          variant="tertiary"
          icon="refresh"
          onClick={() => loadStatus(themeId)}
        >
          Couldn&apos;t check. Try again
        </s-button>
      ) : (
        <s-spinner size="base" accessibilityLabel="Checking the theme" />
      );
    }
    if (row.kind === "code") {
      return status.tableCodeFound ? (
        <s-badge tone="success">Active</s-badge>
      ) : (
        <s-badge>Not added</s-badge>
      );
    }
    if (row.kind === "embed") {
      if (!embed) return <s-badge tone="warning">Needs app embed</s-badge>;
      return s.garage ? (
        <s-badge tone="success">Active</s-badge>
      ) : (
        <s-badge>Off</s-badge>
      );
    }
    return blockStatus(row.key!) !== undefined ? (
      <s-badge tone="success">Active</s-badge>
    ) : (
      <s-badge>Not added</s-badge>
    );
  };

  const actionCell = (row: Row) => {
    if (lockOf(row)) {
      return (
        <s-text>
          <s-link href="/app/plans">Upgrade →</s-link>
        </s-text>
      );
    }
    if (row.kind === "code") {
      // Inside s-text, Polaris underlines the link.
      return (
        <s-text>
          <s-link onClick={() => showTab("table")}>How to add →</s-link>
        </s-text>
      );
    }
    if (row.kind === "embed") {
      return (
        // Just the on/off switch; its settings are in the My Selection tab below.
        <s-switch
          label="Show My Selection"
          labelAccessibilityVisibility="exclusive"
          checked={s.garage}
          disabled={!embed}
          onChange={(e) => save("garage", checkedOf(e))}
        />
      );
    }
    const found = blockStatus(row.key!);
    // Underlined links like "How to add" (inside s-text, Polaris underlines them). Adding needs
    // the app embed and a theme; until then it's plain text.
    if (found !== undefined) {
      return (
        <s-text>
          <s-link
            accessibilityLabel={`Show ${row.name} in the theme editor`}
            onClick={() => {
              // Shopify has no deep link that selects an existing block: say where it is.
              const section = status?.sections?.[row.key!];
              openEditor(
                links.view(found),
                section
                  ? `Theme editor opened. ${row.name} is in the ${section} section.`
                  : "Theme editor opened.",
              );
            }}
          >
            View in editor →
          </s-link>
        </s-text>
      );
    }
    return !embed || !themeId ? (
      <s-text color="subdued">Add to theme</s-text>
    ) : (
      <s-text>
        <s-link
          accessibilityLabel={`Add ${row.name} to the theme in the theme editor`}
          onClick={() => open(links.add[row.key!])}
        >
          Add to theme →
        </s-link>
      </s-text>
    );
  };

  // Fully set up = app embed on and every feature the plan includes is in the theme. Locked rows
  // can't be added, and My Selection's switch is a choice, so neither keeps the card open.
  const integrated =
    !data.themesError &&
    !!status &&
    embed &&
    rows.every((row) =>
      lockOf(row) || row.kind === "embed"
        ? true
        : row.kind === "code"
          ? status.tableCodeFound
          : blockStatus(row.key!) !== undefined,
    );

  const themeCard = (
    <s-section padding="none" accessibilityLabel="Theme integration">
      <s-box padding="base" paddingBlockEnd="none">
        <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
          <SectionTitle icon="theme">Theme integration</SectionTitle>
          <s-stack direction="inline" gap="small-300" alignItems="center">
            {integrated && <s-badge tone="success">All added</s-badge>}
            <s-button
              variant="primary"
              icon="external"
              disabled={!themeId}
              onClick={() => open(links.editor)}
            >
              Open theme editor
            </s-button>
          </s-stack>
        </s-grid>
      </s-box>
      <>
        {data.themesError === "access" && (
          <s-box padding="base">
            <s-banner
              tone="warning"
              heading="SpareFit needs access to your themes"
            >
              SpareFit checks your themes to show whether its blocks and app
              embed are added. Open SpareFit from your apps list and approve the
              updated permissions, then come back to this page.
            </s-banner>
          </s-box>
        )}
        {data.themesError === "other" && (
          <s-box padding="base">
            <s-banner tone="critical" heading="Your themes couldn't be read">
              Reload the page to try again.
            </s-banner>
          </s-box>
        )}
        {!data.themesError && (
          <>
            <s-box padding="base">
              <s-grid
                gridTemplateColumns="minmax(0, 380px) 1fr auto"
                gap="large"
                alignItems="center"
              >
                {/* "Theme" sits left of the dropdown (one line). */}
                <div className="sp-inline-field">
                  <s-text type="strong">Theme</s-text>
                  <Select
                    label="Theme"
                    labelAccessibilityVisibility="exclusive"
                    value={themeId}
                    onChange={(v) => pickTheme(v)}
                  >
                    {data.themes.map((t) => (
                      <Option key={t.id} value={t.id}>
                        {themeLabel(t)}
                      </Option>
                    ))}
                  </Select>
                </div>
                <s-box />
                <s-stack
                  direction="inline"
                  gap="small-300"
                  alignItems="center"
                  justifyContent="end"
                  paddingBlockEnd="small-300"
                >
                  <s-text type="strong">App embed</s-text>
                  <s-badge tone={embed ? "success" : "critical"}>
                    {embed ? "On" : "Off"}
                  </s-badge>
                  <s-switch
                    label="App embed"
                    labelAccessibilityVisibility="exclusive"
                    accessibilityLabel="Turn the app embed on or off in the theme editor"
                    checked={embed}
                    disabled={!status || !themeId}
                    onChange={(e) => {
                      // Apps can't switch the embed: the theme editor opens on its App embeds panel,
                      // and the status is read again when the merchant comes back.
                      const on = checkedOf(e);
                      e.currentTarget.checked = embed;
                      openEditor(
                        on ? links.embedOn : links.embedPanel,
                        on
                          ? "Theme editor opened. Turn on SpareFit there and save."
                          : "Theme editor opened. Turn off SpareFit there and save.",
                      );
                    }}
                  />
                </s-stack>
              </s-grid>
            </s-box>
          </>
        )}
        {!data.themesError && theme && theme.role !== "MAIN" && (
          <s-box paddingInline="base" paddingBlockEnd="base">
            <s-banner
              tone="info"
              heading={`${theme.name} isn't your live theme`}
            >
              You can set SpareFit up here now. Shoppers see it once you publish
              this theme.
            </s-banner>
          </s-box>
        )}
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Feature</s-table-header>
            <s-table-header>Type</s-table-header>
            <s-table-header>Placement</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header>Action</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {rows.map((row) => (
              <s-table-row key={row.name}>
                <s-table-cell>
                  <s-text type="strong">{row.name}</s-text>
                </s-table-cell>
                <s-table-cell>{row.type}</s-table-cell>
                <s-table-cell>
                  <s-text color="subdued">{row.where}</s-text>
                </s-table-cell>
                <s-table-cell>{statusCell(row)}</s-table-cell>
                <s-table-cell>{actionCell(row)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </>
    </s-section>
  );

  // ---------------------------------------------------------------- tabs
  const liveBadge = (
    <s-badge tone="success" icon="view">
      Live preview
    </s-badge>
  );
  const previewNote = (note: string) => (
    <div className="sp-pv-head">
      {liveBadge}
      <s-text color="subdued">{note}</s-text>
    </div>
  );

  const deviceButton = (val: "desktop" | "mobile", label: string) => (
    <s-button
      icon={val}
      variant={device === val ? "secondary" : "tertiary"}
      accessibilityLabel={`${label} preview`}
      onClick={() => setDevice(val)}
    />
  );

  /** A widget colour (#RRGGBB only; anything else puts the saved colour back). */
  const widgetColor = (
    key:
      | "bg"
      | "btn"
      | "ddBg"
      | "ddText"
      | "btnText"
      | "headColor"
      | "labelColor"
      | "saveColor"
      | "resetColor",
    label: string,
    disabled = false,
  ) => (
    <s-color-field
      label={label}
      disabled={disabled}
      // Colours not set yet show what the widget uses: the reset link the button colour,
      // the title, labels and save link the widget's earlier text colour.
      value={s[key] || (key === "resetColor" ? s.btn : s.text)}
      onChange={(e) => {
        const v = valueOf(e);
        if (/^#[0-9a-fA-F]{6}$/.test(v)) save(key, v.toUpperCase());
        else
          e.currentTarget.value =
            s[key] || (key === "resetColor" ? s.btn : s.text);
      }}
    />
  );
  /** Dropdown or search button corners: their own, or the widget's. */
  const partCorners = (key: "ddCorners" | "btnCorners") => (
    <Select
      label="Corners"
      value={s[key]}
      onChange={(v) => save(key, v as StorefrontSettings[typeof key])}
    >
      <Option value="">Same as the widget</Option>
      <Option value="square">Square</Option>
      <Option value="rounded">Rounded</Option>
      <Option value="pill">Pill</Option>
    </Select>
  );
  const widgetTab = (
    <>
      <s-section accessibilityLabel="Live preview">
        <div className="sp-pv-head">
          {liveBadge}
          <s-stack direction="inline" gap="small-300">
            {deviceButton("desktop", "Desktop")}
            {deviceButton("mobile", "Mobile")}
          </s-stack>
        </div>
        <div
          className={`sp-pv-stage${device === "mobile" ? " is-mobile" : ""}`}
        >
          <StorefrontPreview
            kind="search"
            title="Search widget preview"
            config={previewConfig}
            sample={sample}
            assets={data.previewAssets}
            picks={picks}
            onPicks={onPicks}
          />
        </div>
      </s-section>
      <s-section accessibilityLabel="Search widget settings">
        <SectionTitle icon="paint-brush-flat" gap>
          Search widget settings
        </SectionTitle>
        <s-stack gap="large">
          <s-stack gap="base">
            <s-heading>Widget</s-heading>
            <div className="sp-opt-grid sp-three">
              <Select
                label="Layout"
                details="On mobile the dropdowns always stack."
                value={s.layout}
                onChange={(v) =>
                  save("layout", v as StorefrontSettings["layout"])
                }
              >
                <Option value="bar">Horizontal (one row)</Option>
                <Option value="card">Vertical (stacked)</Option>
              </Select>
              {widgetColor("bg", "Background")}
              <Select
                label="Corners"
                value={s.corners}
                onChange={(v) =>
                  save("corners", v as StorefrontSettings["corners"])
                }
              >
                <Option value="square">Square</Option>
                <Option value="rounded">Rounded</Option>
                <Option value="pill">Pill</Option>
              </Select>
            </div>
          </s-stack>
          <s-divider />
          <s-stack gap="base">
            <s-heading>Title</s-heading>
            <div className="sp-opt-grid sp-three">
              <s-text-field
                label="Search heading"
                value={heading}
                maxLength={200}
                onInput={(e) => setHeading(valueOf(e))}
              />
              {widgetColor("headColor", "Title colour", !s.showHeading)}
              <div className="sp-opt-grid__check">
                <s-checkbox
                  label="Show the title"
                  checked={s.showHeading}
                  onChange={(e) => save("showHeading", checkedOf(e))}
                />
              </div>
            </div>
          </s-stack>
          <s-divider />
          <s-stack gap="base">
            <s-heading>Dropdowns</s-heading>
            <div className="sp-opt-grid sp-three">
              {widgetColor("ddBg", "Background")}
              {widgetColor("ddText", "Text colour")}
              {partCorners("ddCorners")}
            </div>
            <div className="sp-opt-grid sp-three">
              {widgetColor("labelColor", "Label colour", !s.labels)}
              <div className="sp-opt-grid__check">
                <s-checkbox
                  label="Show labels above the dropdowns"
                  details="Off: the field name is shown inside each dropdown instead."
                  checked={s.labels}
                  onChange={(e) => save("labels", checkedOf(e))}
                />
              </div>
              <span aria-hidden="true" />
            </div>
          </s-stack>
          <s-divider />
          <s-stack gap="base">
            <s-heading>Search button</s-heading>
            <div className="sp-opt-grid sp-three">
              <s-text-field
                label="Button text"
                maxLength={200}
                {...textProps("button")}
              />
              <Select
                label="Button action"
                value={s.results}
                onChange={(v) =>
                  save("results", v as StorefrontSettings["results"])
                }
              >
                <Option value="theme">Open the default search page</Option>
                <Option value="app">Open SpareFit&apos;s results page</Option>
              </Select>
              <span aria-hidden="true" />
            </div>
            <div className="sp-opt-grid sp-three">
              {widgetColor("btn", "Button colour")}
              {widgetColor("btnText", "Text colour")}
              {partCorners("btnCorners")}
            </div>
          </s-stack>
          <s-divider />
          <s-stack gap="base">
            <s-heading>Save to My Selection</s-heading>
            <div className="sp-opt-grid sp-three">
              <s-text-field
                label="Link text"
                maxLength={200}
                disabled={!s.saveLink}
                {...textProps("saveText")}
              />
              {widgetColor("saveColor", "Link colour", !s.saveLink)}
              <div className="sp-opt-grid__check">
                <s-checkbox
                  label="Show the save link"
                  checked={s.saveLink}
                  onChange={(e) => save("saveLink", checkedOf(e))}
                />
              </div>
            </div>
          </s-stack>
          <s-divider />
          <s-stack gap="base">
            <s-heading>Reset link</s-heading>
            <div className="sp-opt-grid sp-three">
              <s-text-field
                label="Link text"
                maxLength={200}
                disabled={!s.reset}
                {...textProps("resetText")}
              />
              {widgetColor("resetColor", "Link colour", !s.reset)}
              <div className="sp-opt-grid__check">
                <s-checkbox
                  label="Show the reset link"
                  checked={s.reset}
                  onChange={(e) => save("reset", checkedOf(e))}
                />
              </div>
            </div>
          </s-stack>
        </s-stack>
      </s-section>
      <s-section accessibilityLabel="Dropdown fields">
        <SectionTitle icon="info" gap>
          Dropdown fields
        </SectionTitle>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-text color="subdued">
            Dropdowns and their placeholder text come from your search fields:
          </s-text>
          {config.fields.map((f) => (
            <s-chip key={f.id}>{f.label}</s-chip>
          ))}
          <s-link
            onClick={() => void leave(() => navigate("/app/search-setup"))}
          >
            Edit fields
          </s-link>
        </s-stack>
      </s-section>
    </>
  );

  // A feature the plan doesn't include: its settings stay editable, with this banner on top.
  const lockBanner = (feature: string, lock: string | null) =>
    lock && (
      <s-box paddingBlockEnd="base">
        <s-banner
          tone="info"
          heading={
            lock === "a higher"
              ? `${feature} needs a higher plan`
              : `${feature} needs the ${lock} plan`
          }
        >
          You can set it up now. It shows on your store after you upgrade.
          <s-button
            slot="secondary-actions"
            onClick={() => navigate("/app/plans")}
          >
            Compare plans
          </s-button>
        </s-banner>
      </s-box>
    );

  const badgeTab = (
    <s-grid
      gridTemplateColumns="minmax(0, 1fr) minmax(0, 1fr)"
      gap="base"
      alignItems="start"
    >
      <s-section accessibilityLabel="Fits badge">
        <SectionTitle icon="check-circle" gap>
          Fits badge
        </SectionTitle>
        <s-box paddingBlockEnd="base">
          <s-paragraph color="subdued">
            Tells shoppers on the product page whether it fits what they picked.
            Place it in the theme editor, usually above Add to cart.
          </s-paragraph>
        </s-box>
        {lockBanner("Fits badge", data.locked.badge)}
        <s-stack gap="base">
          <s-stack gap="small-300">
            <p className="sp-grp-t">Before a selection</p>
            <s-text-field
              label="Text"
              maxLength={200}
              {...textProps("askText")}
            />
          </s-stack>
          <s-divider />
          <s-stack gap="small-300">
            <p className="sp-grp-t">When it fits</p>
            <s-text-field
              label="Text"
              maxLength={200}
              {...textProps("fitsText")}
            />
          </s-stack>
          <s-divider />
          <s-stack gap="small-300">
            <p className="sp-grp-t">When it doesn&apos;t fit</p>
            <s-text-field
              label="Text"
              maxLength={200}
              {...textProps("noFitText")}
            />
            <s-checkbox
              label={`Show a link to ${things} that fit`}
              checked={s.noFitLink}
              onChange={(e) => save("noFitLink", checkedOf(e))}
            />
            {s.noFitLink && (
              <s-text-field
                label="Link text"
                maxLength={200}
                {...textProps("noFitLinkText")}
              />
            )}
          </s-stack>
          <s-divider />
          <s-checkbox
            label="Show the shopper's selection under the text"
            details={`${data.exampleLabel ? `For example ${data.exampleLabel}. ` : ""}Shown when it fits and when it doesn't.`}
            checked={s.badgeSel}
            onChange={(e) => save("badgeSel", checkedOf(e))}
          />
        </s-stack>
      </s-section>
      <s-section accessibilityLabel="Live preview">
        {previewNote("All three states, as shoppers see them.")}
        <StorefrontPreview
          kind="badge"
          title="Fits badge preview"
          config={previewConfig}
          sample={sample}
          assets={data.previewAssets}
        />
      </s-section>
    </s-grid>
  );

  const tableTab = (
    <s-grid
      gridTemplateColumns="minmax(0, 1fr) minmax(0, 1fr)"
      gap="base"
      alignItems="start"
    >
      <s-section accessibilityLabel="Fitment table">
        <SectionTitle icon="table" gap>
          Fitment table
        </SectionTitle>
        <s-box paddingBlockEnd="base">
          <s-paragraph color="subdued">
            Lists everything this product fits.
          </s-paragraph>
        </s-box>
        {lockBanner("Fitment table", data.locked.table)}
        <s-stack gap="base">
          <s-stack gap="small-300">
            <p className="sp-grp-t">Where to show it</p>
            <Select
              label="Show the table"
              labelAccessibilityVisibility="exclusive"
              value={s.tablePlace}
              onChange={(v) =>
                save("tablePlace", v as StorefrontSettings["tablePlace"])
              }
            >
              <Option value="block">Use as block</Option>
              <Option value="tabs">Use as shortcode</Option>
            </Select>
            {inTabs ? (
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack gap="small-300">
                  <s-text type="strong">Add the shortcode in 3 steps</s-text>
                  <ol className="sp-steps">
                    <li>
                      In the theme editor, open a product page and pick where
                      the table should go: any spot that shows text, such as a
                      text or Custom Liquid block, a collapsible row or a tab.
                    </li>
                    <li>
                      Paste this shortcode there:
                      <span className="sp-code-row">
                        <code>{TABLE_CODE}</code>
                        <s-button
                          variant="tertiary"
                          icon="clipboard"
                          onClick={copyCode}
                        >
                          Copy
                        </s-button>
                      </span>
                    </li>
                    <li>
                      Save. SpareFit replaces the shortcode with the table on
                      every product page.
                    </li>
                  </ol>
                  <s-text color="subdued">
                    Needs the app embed (Theme integration). Products with no
                    rows follow “When a product has no rows” below.
                  </s-text>
                  <s-stack direction="inline">
                    <s-button
                      icon="external"
                      disabled={!themeId}
                      onClick={() => open(links.product)}
                    >
                      Open theme editor
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            ) : (
              <s-text color="subdued">
                Add it to any section on the product page that supports app
                blocks, then drag it where you want it in the theme editor.
              </s-text>
            )}
          </s-stack>
          <s-divider />
          <s-stack gap="small-300">
            <p className="sp-grp-t">Display</p>
            {!inTabs && (
              <>
                <s-text-field
                  label="Title"
                  maxLength={200}
                  {...textProps("tableTitle")}
                />
                <Select
                  label="Show as"
                  value={s.tableStyle}
                  onChange={(v) =>
                    save("tableStyle", v as StorefrontSettings["tableStyle"])
                  }
                >
                  <Option value="collapsible">Collapsible row</Option>
                  <Option value="open">Open table</Option>
                </Select>
                {s.tableStyle === "collapsible" && (
                  <s-checkbox
                    label="Open by default"
                    checked={s.tableOpen}
                    onChange={(e) => save("tableOpen", checkedOf(e))}
                  />
                )}
              </>
            )}
            {inTabs && (
              <s-text color="subdued">
                The shortcode shows just the table. Add a heading above it in
                your theme if you want one.
              </s-text>
            )}
          </s-stack>
          <s-divider />
          <s-stack gap="small-300">
            <p className="sp-grp-t">Columns</p>
            <s-text color="subdued">
              One column per search field, in the same order as Search setup.
            </s-text>
            <s-stack direction="inline" gap="small-100 base">
              {config.fields.map((f) => {
                const on = !s.tableHide[f.id];
                return (
                  <s-checkbox
                    key={f.id}
                    label={f.label}
                    checked={on}
                    // The last column left on can't be turned off.
                    disabled={on && shownCols.length === 1}
                    onChange={(e) => {
                      const hide = { ...s.tableHide };
                      if (checkedOf(e)) delete hide[f.id];
                      else hide[f.id] = true;
                      save("tableHide", hide);
                    }}
                  />
                );
              })}
            </s-stack>
          </s-stack>
          <s-divider />
          <s-stack gap="small-300">
            <p className="sp-grp-t">Rows</p>
            <s-grid
              gridTemplateColumns="minmax(0, 1fr) minmax(0, 1fr)"
              gap="base"
              alignItems="end"
            >
              <Select
                label="Sort by"
                value={s.tableSort}
                onChange={(v) =>
                  save("tableSort", v as StorefrontSettings["tableSort"])
                }
              >
                <Option value="fields">Search field order (A–Z)</Option>
                {yearField && (
                  <Option value="year">
                    Newest {yearField.label.toLowerCase()} first
                  </Option>
                )}
              </Select>
              <Select
                label="Rows before “Show all”"
                value={s.tableRows}
                onChange={(v) =>
                  save("tableRows", v as StorefrontSettings["tableRows"])
                }
              >
                <Option value="5">5</Option>
                <Option value="10">10</Option>
                <Option value="all">All</Option>
              </Select>
              <Select
                label="Colour style"
                value={s.tableLook}
                onChange={(v) =>
                  save("tableLook", v as StorefrontSettings["tableLook"])
                }
              >
                <Option value="lines">Lines between rows</Option>
                <Option value="striped">Striped rows</Option>
                <Option value="plain">Plain</Option>
              </Select>
            </s-grid>
          </s-stack>
          <s-divider />
          <s-stack gap="small-300">
            <p className="sp-grp-t">When a product has no rows</p>
            <Select
              label="Show"
              labelAccessibilityVisibility="exclusive"
              value={s.tableEmpty}
              onChange={(v) =>
                save("tableEmpty", v as StorefrontSettings["tableEmpty"])
              }
            >
              <Option value="hide">Hide the table</Option>
              <Option value="text">Show a text instead</Option>
            </Select>
            {s.tableEmpty === "text" && (
              <s-text-field
                label="Text"
                details="Useful for universal products."
                maxLength={200}
                {...textProps("tableEmptyText")}
              />
            )}
          </s-stack>
        </s-stack>
      </s-section>
      <s-section accessibilityLabel="Live preview">
        {previewNote(
          inTabs
            ? "Where you paste the shortcode. An example using the first rows of your filter data."
            : "An example using the first rows of your filter data.",
        )}
        <StorefrontPreview
          kind="table"
          title="Fitment table preview"
          config={previewConfig}
          sample={sample}
          assets={data.previewAssets}
        />
      </s-section>
    </s-grid>
  );

  const nounLabel = noun.charAt(0).toUpperCase() + noun.slice(1);
  const garageTab = (
    <s-grid
      gridTemplateColumns="minmax(0, 1fr) minmax(0, 1fr)"
      gap="base"
      alignItems="start"
    >
      <s-section accessibilityLabel="My Selection">
        <SectionTitle icon="star" gap>
          My Selection
        </SectionTitle>
        <s-box paddingBlockEnd="base">
          <s-paragraph color="subdued">
            A floating button that stays in a corner of every page. Shoppers
            save what they searched for and pick it again on their next visit.
            It&apos;s part of the app embed, so there&apos;s nothing to place in
            the theme.
          </s-paragraph>
        </s-box>
        {lockBanner("My Selection", data.locked.garage)}
        {!data.locked.garage && status && !embed && (
          <s-box paddingBlockEnd="base">
            <s-banner
              tone="warning"
              heading="Turn on the app embed to show the button"
            >
              The button is part of the app embed in Theme integration.
            </s-banner>
          </s-box>
        )}
        {!data.locked.garage && embed && !s.garage && (
          <s-box paddingBlockEnd="base">
            <s-banner tone="info" heading="My Selection is turned off">
              Turn it on with its switch in Theme integration above. You can
              still set it up here.
            </s-banner>
          </s-box>
        )}
        <s-box paddingBlockStart="base">
          <div className="sp-opt-grid sp-one">
            <s-text-field
              label="Name shoppers see"
              details="For example My Selection, My Garage or My Devices."
              maxLength={200}
              {...textProps("garageName")}
            />
            <Select
              label="Position"
              value={s.savedPos}
              onChange={(v) =>
                save("savedPos", v as StorefrontSettings["savedPos"])
              }
            >
              <Option value="right-middle">
                Right edge, middle (vertical tab)
              </Option>
              <Option value="left-middle">
                Left edge, middle (vertical tab)
              </Option>
              <Option value="bottom-right">Bottom right</Option>
              <Option value="bottom-left">Bottom left</Option>
            </Select>
            <Select
              label="Icon"
              value={s.savedIcon}
              onChange={(v) =>
                save("savedIcon", v as StorefrontSettings["savedIcon"])
              }
            >
              <Option value="star">Star</Option>
              <Option value="heart">Heart</Option>
              <Option value="bookmark">Bookmark</Option>
              <Option value="clock">Clock (recent)</Option>
              <Option value={data.storeIcon}>{nounLabel}</Option>
              <Option value="custom">Custom (upload your own)</Option>
              <Option value="none">No icon</Option>
            </Select>
            {s.savedIcon === "custom" && (
              <s-stack gap="small-200">
                <s-drop-zone
                  label="Upload an icon"
                  accept=".svg,.png,image/svg+xml,image/png"
                  disabled={iconBusy}
                  error={iconError}
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    // Cleared, so choosing the same file again fires change.
                    e.currentTarget.value = "";
                    uploadIcon(file);
                  }}
                  onDropRejected={() =>
                    setIconError("Choose an SVG or PNG file.")
                  }
                />
                <s-text color="subdued">
                  {iconBusy
                    ? "Uploading…"
                    : "SVG or PNG, square, at least 48 × 48 px, up to 100 KB. Shown at 24 px next to the name."}
                </s-text>
                {s.savedIconUrl && (
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    alignItems="center"
                  >
                    <s-text color="subdued">Icon uploaded.</s-text>
                    <s-button
                      variant="tertiary"
                      onClick={() => save("savedIconUrl", "")}
                    >
                      Remove
                    </s-button>
                  </s-stack>
                )}
              </s-stack>
            )}
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              {(
                [
                  ["savedBg", "Background colour"],
                  ["savedText", "Text colour"],
                ] as const
              ).map(([key, label]) => (
                <s-color-field
                  key={key}
                  label={label}
                  value={s[key]}
                  onChange={(e) => {
                    const v = valueOf(e);
                    if (/^#[0-9a-fA-F]{6}$/.test(v)) save(key, v.toUpperCase());
                    else e.currentTarget.value = s[key];
                  }}
                />
              ))}
            </s-grid>
            <Select
              label="Saved selections per shopper"
              value={s.maxSaved}
              onChange={(v) =>
                save("maxSaved", v as StorefrontSettings["maxSaved"])
              }
            >
              <Option value="3">3</Option>
              <Option value="5">5</Option>
              <Option value="10">10</Option>
            </Select>
            <s-checkbox
              label="Show saved selection count"
              checked={s.savedCount}
              onChange={(e) => save("savedCount", checkedOf(e))}
            />
          </div>
        </s-box>
      </s-section>
      <s-section accessibilityLabel="Live preview">
        {previewNote(
          "Hover the tab or click it to try it. Looks the same on desktop and mobile.",
        )}
        <div className="sp-mini-win">
          <div className="sp-mw-bar">
            <i />
            <i />
            <i />
            <em>your-store.com</em>
          </div>
          {s.garage ? (
            <StorefrontPreview
              kind="selection"
              title="My Selection preview"
              config={previewConfig}
              sample={sample}
              assets={data.previewAssets}
            />
          ) : (
            <div style={{ height: SELECTION_HEIGHT }} />
          )}
        </div>
      </s-section>
    </s-grid>
  );

  // ---------------------------------------------------------------- results page tab
  const [editFilter, setEditFilter] = useState<ResultsFilter | null>(null);
  const [fLabel, setFLabel] = useState("");
  const [fTags, setFTags] = useState<string[]>([]);
  const [fErrors, setFErrors] = useState<{ label?: string; tags?: string }>({});
  const [deleting, setDeleting] = useState<ResultsFilter | null>(null);
  // A new key per modal opening gives the tag picker a fresh search.
  const [pickerKey, setPickerKey] = useState(0);
  // Badges from tags: one badge per modal (add / edit), like filter groups.
  const [editBadge, setEditBadge] = useState<BadgeTag | null>(null);
  const [badgeDraft, setBadgeDraft] = useState<BadgeTag>({
    tag: "",
    ...BADGE_TAG_COLORS,
    active: true,
    label: "",
  });
  /** Editing the colours of a built-in badge (no tag to pick). */
  const [editBuiltin, setEditBuiltin] = useState<"soldOut" | "sale" | null>(
    null,
  );
  const [badgeError, setBadgeError] = useState("");
  const [deletingBadge, setDeletingBadge] = useState<BadgeTag | null>(null);
  /** A colour field that only takes #RRGGBB (empty only where `empty` allows it). */
  const colorField = (
    label: string,
    value: string,
    set: (v: string) => void,
    placeholder: string,
    empty = false,
    disabled = false,
  ) => (
    <s-color-field
      label={label}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const v = valueOf(e).trim();
        if (!v && empty) set("");
        else if (/^#[0-9a-fA-F]{6}$/.test(v)) set(v.toUpperCase());
        else e.currentTarget.value = value;
      }}
    />
  );
  /** Desktop / mobile icon in front of a field whose label is hidden (its pair has a title). */
  const deviceIcon = (device: "desktop" | "mobile") => (
    <span
      className="sp-dev__icon"
      title={device === "desktop" ? "Desktop" : "Mobile"}
    >
      <s-icon type={device} tone="neutral" />
    </span>
  );
  const shapeOptions = (
    [
      ["square", "Square"],
      ["rounded", "Rounded"],
      ["pill", "Pill"],
    ] as const
  ).map(([value, label]) => (
    <Option key={value} value={value}>
      {label}
    </Option>
  ));
  const setRpKey = <K extends keyof ResultsPageSettings>(
    key: K,
    value: ResultsPageSettings[K],
  ) => setRp((cur) => ({ ...cur, [key]: value }));

  const openFilter = (f: ResultsFilter | null) => {
    setEditFilter(f);
    setFLabel(f?.label ?? "");
    setFTags(f?.tags ?? []);
    setFErrors({});
    setPickerKey((k) => k + 1);
    void shopify.modal.show(FILTER_MODAL);
  };
  /** Badges are found by their tag (unique, any case), not by object: the list may be rebuilt. */
  const sameTag = (a: BadgeTag, b: BadgeTag | null) =>
    !!b && a.tag.toLowerCase() === b.tag.toLowerCase();
  const openBadge = (b: BadgeTag | null) => {
    setEditBadge(b);
    setEditBuiltin(null);
    setBadgeDraft(
      b ?? { tag: "", ...BADGE_TAG_COLORS, active: true, label: "" },
    );
    setBadgeError("");
    setPickerKey((k) => k + 1);
    void shopify.modal.show(BADGE_MODAL);
  };
  const openBuiltin = (kind: "soldOut" | "sale") => {
    setEditBadge(null);
    setEditBuiltin(kind);
    setBadgeDraft({
      tag: kind === "soldOut" ? "Sold out" : "Sale",
      bg: kind === "soldOut" ? rp.soldOutBg : rp.saleBg,
      color: kind === "soldOut" ? rp.soldOutColor : rp.saleColor,
      active: true,
      label: kind === "soldOut" ? rp.soldOutLabel : rp.saleLabel,
    });
    setBadgeError("");
    void shopify.modal.show(BADGE_MODAL);
  };
  const saveBadge = () => {
    if (editBuiltin) {
      setRp((cur) => ({
        ...cur,
        ...(editBuiltin === "soldOut"
          ? {
              soldOutBg: badgeDraft.bg,
              soldOutColor: badgeDraft.color,
              soldOutLabel: badgeDraft.label.trim(),
            }
          : {
              saleBg: badgeDraft.bg,
              saleColor: badgeDraft.color,
              saleLabel: badgeDraft.label.trim(),
            }),
      }));
      void shopify.modal.hide(BADGE_MODAL);
      return;
    }
    const tag = badgeDraft.tag.trim();
    const taken = rp.badgeTags.some(
      (b) =>
        !sameTag(b, editBadge) && b.tag.toLowerCase() === tag.toLowerCase(),
    );
    const error = !tag
      ? "Pick a tag"
      : taken
        ? "This tag already has a badge"
        : "";
    setBadgeError(error);
    if (error) return;
    const next = { ...badgeDraft, tag, label: badgeDraft.label.trim() };
    setRp((cur) => ({
      ...cur,
      badgeTags: editBadge
        ? cur.badgeTags.map((b) => (sameTag(b, editBadge) ? next : b))
        : [...cur.badgeTags, next],
    }));
    void shopify.modal.hide(BADGE_MODAL);
  };
  /** Tag badges only: their order is the order badges show in (3 at most per card). */
  const moveBadge = (i: number, by: number) =>
    setRp((cur) => {
      const badgeTags = [...cur.badgeTags];
      const [b] = badgeTags.splice(i, 1);
      badgeTags.splice(i + by, 0, b);
      return { ...cur, badgeTags };
    });
  const askDeleteBadge = (b: BadgeTag) => {
    setDeletingBadge(b);
    void shopify.modal.show(BADGE_DELETE_MODAL);
  };
  const deleteBadge = () => {
    if (deletingBadge) {
      setRp((cur) => ({
        ...cur,
        badgeTags: cur.badgeTags.filter((b) => !sameTag(b, deletingBadge)),
      }));
    }
    void shopify.modal.hide(BADGE_DELETE_MODAL);
  };
  /** A badge as shoppers see it: its label, or the tag (or built-in name) without one. */
  const badgePill = (
    b: Pick<BadgeTag, "tag" | "bg" | "color"> & { label?: string },
  ) => (
    <span
      className="sp-rp-badgepill"
      style={{
        background: b.bg,
        color: b.color,
        borderRadius: SHAPE_RADIUS[rp.badgeShape],
        fontSize: rp.badgeSize ? `${rp.badgeSize}px` : undefined,
        fontWeight: Number(rp.badgeWeight),
      }}
    >
      {b.label?.trim() || b.tag}
    </span>
  );
  const saveFilter = () => {
    const label = fLabel.trim();
    const errors: { label?: string; tags?: string } = {};
    if (!label) errors.label = "Enter a name";
    if (!fTags.length) errors.tags = "Pick at least one tag";
    setFErrors(errors);
    if (errors.label || errors.tags) return;
    setRp((cur) => ({
      ...cur,
      filters: editFilter
        ? cur.filters.map((f) =>
            f.id === editFilter.id ? { ...f, label, tags: fTags } : f,
          )
        : [
            ...cur.filters,
            {
              id: newFilterId(cur.filters.map((f) => f.id)),
              label,
              tags: fTags,
            },
          ],
    }));
    void shopify.modal.hide(FILTER_MODAL);
  };
  const moveFilter = (i: number, by: number) =>
    setRp((cur) => {
      const filters = [...cur.filters];
      const [f] = filters.splice(i, 1);
      filters.splice(i + by, 0, f);
      return { ...cur, filters };
    });
  const askDelete = (f: ResultsFilter) => {
    setDeleting(f);
    void shopify.modal.show(FILTER_DELETE_MODAL);
  };
  const deleteFilter = () => {
    if (deleting) {
      setRp((cur) => ({
        ...cur,
        filters: cur.filters.filter((f) => f.id !== deleting.id),
      }));
    }
    void shopify.modal.hide(FILTER_DELETE_MODAL);
  };

  // The badges table: the two built-in badges first, then the tag badges.
  const badgeRows = [
    {
      key: "soldOut",
      badge: {
        tag: "Sold out",
        bg: rp.soldOutBg,
        color: rp.soldOutColor,
        label: rp.soldOutLabel,
      },
      when: "The product can't be bought",
      active: rp.cardSoldOut,
      toggle: (on: boolean) => setRpKey("cardSoldOut", on),
      edit: () => openBuiltin("soldOut"),
      remove: null,
      up: null,
      down: null,
    },
    {
      key: "sale",
      badge: {
        tag: "Sale",
        bg: rp.saleBg,
        color: rp.saleColor,
        label: rp.saleLabel,
      },
      when: "Compare-at price is higher than the price",
      active: rp.badgeSale,
      toggle: (on: boolean) => setRpKey("badgeSale", on),
      edit: () => openBuiltin("sale"),
      remove: null,
      up: null,
      down: null,
    },
    ...rp.badgeTags.map((b, i) => ({
      key: `tag:${b.tag}`,
      badge: b,
      when: `Tag: ${b.tag}`,
      active: b.active !== false,
      toggle: (on: boolean) =>
        setRp((cur) => ({
          ...cur,
          badgeTags: cur.badgeTags.map((x) =>
            sameTag(x, b) ? { ...x, active: on } : x,
          ),
        })),
      edit: () => openBadge(b),
      remove: (() => askDeleteBadge(b)) as (() => void) | null,
      up: (i > 0 ? () => moveBadge(i, -1) : null) as (() => void) | null,
      down: (i < rp.badgeTags.length - 1 ? () => moveBadge(i, 1) : null) as
        (() => void) | null,
    })),
  ];

  const resultsTab = (
    <>
      {s.results !== "app" && (
        <s-banner tone="info" heading="Shoppers don't see this page yet">
          Results open on your store&apos;s search page. To use this page, set
          the search button&apos;s Button action to Open SpareFit&apos;s results
          page in the Search widget tab.
          <s-button slot="secondary-actions" onClick={() => showTab("widget")}>
            Go to Search widget
          </s-button>
        </s-banner>
      )}
      {data.results.tagsLoading && (
        <s-banner tone="info" heading="Reading your product tags">
          SpareFit is loading your products&apos; tags from Shopify. Filter
          values show in the preview when it&apos;s done; refresh the page in a
          few minutes.
        </s-banner>
      )}
      <div className="sp-rpside">
        <nav className="sp-rpside__nav" aria-label="Results page settings">
          <div role="tablist" aria-orientation="vertical">
            {RP_SECTIONS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={rpSection === k}
                onClick={() => setRpSection(k)}
              >
                <Icon name={RP_ICON[k]} size={18} />
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="sp-rpside__preview"
            onClick={() => void shopify.modal.show(RESULTS_PREVIEW_MODAL)}
          >
            <Icon name="eye" size={18} />
            Preview
          </button>
        </nav>
        <div className="sp-rpside__main">
          {rpSection === "page" && (
            <s-section accessibilityLabel="Page settings">
              <SectionTitle icon="page" gap>
                Page
              </SectionTitle>
              <s-stack gap="large">
                <s-stack gap="base">
                  <s-heading>Page width</s-heading>
                  <Select
                    label="Page width"
                    labelAccessibilityVisibility="exclusive"
                    value={rp.pageWidth}
                    onChange={(v) =>
                      setRpKey(
                        "pageWidth",
                        v as ResultsPageSettings["pageWidth"],
                      )
                    }
                  >
                    <Option value="theme">Theme width</Option>
                    <Option value="full">Full width</Option>
                    <Option value="custom">Custom width</Option>
                  </Select>
                  {rp.pageWidth === "custom" && (
                    <s-number-field
                      label="Maximum width"
                      suffix="px"
                      details={`${PAGE_WIDTH_MIN}–${PAGE_WIDTH_MAX} px. Narrower screens use their full width.`}
                      min={PAGE_WIDTH_MIN}
                      max={PAGE_WIDTH_MAX}
                      step={10}
                      value={String(rp.pageMaxWidth)}
                      onChange={(e) => {
                        const n = Math.round(Number(valueOf(e)));
                        setRpKey(
                          "pageMaxWidth",
                          Number.isFinite(n) && n > 0
                            ? Math.min(
                                PAGE_WIDTH_MAX,
                                Math.max(PAGE_WIDTH_MIN, n),
                              )
                            : defaultResultsPage().pageMaxWidth,
                        );
                      }}
                    />
                  )}
                </s-stack>
                <s-divider />
                <s-stack gap="base">
                  <s-heading>Search widget</s-heading>
                  <s-checkbox
                    label="Show the search widget at the top of the page"
                    details="Prefilled with the shopper's selection, so they can change it without leaving the page."
                    checked={rp.showWidget}
                    onChange={(e) => setRpKey("showWidget", checkedOf(e))}
                  />
                </s-stack>
                <s-divider />
                <s-stack gap="base">
                  <s-heading>Results page title</s-heading>
                  <s-checkbox
                    label="Show the page title"
                    checked={rp.showTitle}
                    onChange={(e) => setRpKey("showTitle", checkedOf(e))}
                  />
                  {rp.showTitle && (
                    <>
                      <s-text-field
                        label="Page title"
                        details="Leave it empty to use the title for your store type."
                        placeholder={defaultPageTitle(config)}
                        value={rp.pageTitle}
                        maxLength={PAGE_TITLE_MAX}
                        onInput={(e) => setRpKey("pageTitle", valueOf(e))}
                      />
                      <div className="sp-rp-trio">
                        <Select
                          label="Alignment"
                          value={rp.titleAlign}
                          onChange={(v) =>
                            setRpKey(
                              "titleAlign",
                              v as ResultsPageSettings["titleAlign"],
                            )
                          }
                        >
                          <Option value="left">Left</Option>
                          <Option value="center">Center</Option>
                          <Option value="right">Right</Option>
                        </Select>
                        <Select
                          label="Weight"
                          value={rp.titleWeight}
                          onChange={(v) =>
                            setRpKey(
                              "titleWeight",
                              v as ResultsPageSettings["titleWeight"],
                            )
                          }
                        >
                          <Option value="">Theme</Option>
                          <Option value="400">Regular</Option>
                          <Option value="500">Medium</Option>
                          <Option value="600">Semibold</Option>
                          <Option value="700">Bold</Option>
                          <Option value="800">Extra bold</Option>
                        </Select>
                        <s-color-field
                          label="Colour"
                          placeholder="Theme"
                          value={rp.titleColor}
                          onChange={(e) => {
                            const v = valueOf(e).trim();
                            if (!v) setRpKey("titleColor", "");
                            else if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                              setRpKey("titleColor", v.toUpperCase());
                            } else e.currentTarget.value = rp.titleColor;
                          }}
                        />
                      </div>
                      <div className="sp-dev">
                        <span className="sp-dev__label">Font size</span>
                        <div className="sp-rp-trio">
                          <div className="sp-dev__field">
                            {deviceIcon("desktop")}
                            <s-number-field
                              label="Title size on desktop"
                              labelAccessibilityVisibility="exclusive"
                              suffix="px"
                              placeholder={"Theme"}
                              min={TITLE_SIZE_MIN}
                              max={TITLE_SIZE_MAX}
                              step={1}
                              value={rp.titleSize ? String(rp.titleSize) : ""}
                              onChange={(e) => {
                                const v = valueOf(e).trim();
                                const n = Math.round(Number(v));
                                setRpKey(
                                  "titleSize",
                                  !v || !Number.isFinite(n)
                                    ? 0
                                    : Math.min(
                                        TITLE_SIZE_MAX,
                                        Math.max(TITLE_SIZE_MIN, n),
                                      ),
                                );
                              }}
                            />
                          </div>
                          <div className="sp-dev__field">
                            {deviceIcon("mobile")}
                            <s-number-field
                              label="Title size on mobile"
                              labelAccessibilityVisibility="exclusive"
                              suffix="px"
                              placeholder={"Same as desktop"}
                              min={TITLE_SIZE_MIN}
                              max={TITLE_SIZE_MAX}
                              step={1}
                              value={
                                rp.titleSizeMobile
                                  ? String(rp.titleSizeMobile)
                                  : ""
                              }
                              onChange={(e) => {
                                const v = valueOf(e).trim();
                                const n = Math.round(Number(v));
                                setRpKey(
                                  "titleSizeMobile",
                                  !v || !Number.isFinite(n)
                                    ? 0
                                    : Math.min(
                                        TITLE_SIZE_MAX,
                                        Math.max(TITLE_SIZE_MIN, n),
                                      ),
                                );
                              }}
                            />
                          </div>
                          <span aria-hidden="true" />
                        </div>
                      </div>
                    </>
                  )}
                </s-stack>
                <s-divider />
                <s-stack gap="base">
                  <s-heading>When no products are found</s-heading>
                  <s-text-field
                    label="Message"
                    placeholder={config.s.noResults}
                    details="Leave it empty to use the search widget's No results text."
                    value={rp.emptyText}
                    maxLength={EMPTY_TEXT_MAX}
                    onInput={(e) => setRpKey("emptyText", valueOf(e))}
                  />
                  <div className="sp-rp-pair">
                    <s-text-field
                      label="Button text"
                      placeholder="e.g. Browse all products"
                      details="Leave it empty for no button."
                      value={rp.emptyButton}
                      maxLength={CART_TEXT_MAX}
                      onInput={(e) => setRpKey("emptyButton", valueOf(e))}
                    />
                    <s-text-field
                      label="Button link"
                      placeholder="/collections/all"
                      value={rp.emptyUrl}
                      maxLength={500}
                      error={
                        rp.emptyUrl && !SAFE_LINK.test(rp.emptyUrl)
                          ? "Enter a link that starts with / or https://"
                          : undefined
                      }
                      onInput={(e) => setRpKey("emptyUrl", valueOf(e).trim())}
                    />
                  </div>
                </s-stack>
              </s-stack>
            </s-section>
          )}

          {rpSection === "grid" && (
            <s-section accessibilityLabel="Product grid settings">
              <SectionTitle icon="layout-columns-3" gap>
                Product grid
              </SectionTitle>
              <s-stack gap="large">
                <s-stack gap="base">
                  <s-heading>Results count and sorting</s-heading>
                  <s-checkbox
                    label="Show the number of results"
                    details="Above the products, e.g. 24 results."
                    checked={rp.showCount}
                    onChange={(e) => setRpKey("showCount", checkedOf(e))}
                  />
                  <s-checkbox
                    label="Show the Sort by menu"
                    checked={rp.showSort}
                    onChange={(e) => setRpKey("showSort", checkedOf(e))}
                  />
                  <Select
                    label="Sort by default"
                    value={rp.sort}
                    onChange={(v) =>
                      setRpKey("sort", v as ResultsPageSettings["sort"])
                    }
                  >
                    {SORTS.map(([value, label]) => (
                      <Option key={value} value={value}>
                        {label}
                      </Option>
                    ))}
                  </Select>
                </s-stack>
                <s-divider />
                <s-stack gap="base">
                  <s-heading>Layout</s-heading>
                  <div className="sp-dev">
                    <span className="sp-dev__label">Products per row</span>
                    <div className="sp-rp-pair">
                      <div className="sp-dev__field">
                        {deviceIcon("desktop")}
                        <Select
                          label="Products per row on desktop"
                          labelAccessibilityVisibility="exclusive"
                          value={rp.columns}
                          onChange={(v) =>
                            // Rows that no longer fit the page are trimmed (20 products at most).
                            setRp((cur) => ({
                              ...cur,
                              columns: v as ResultsPageSettings["columns"],
                              rowsPerPage: Math.min(
                                cur.rowsPerPage,
                                maxRows(Number(v)),
                              ),
                            }))
                          }
                        >
                          <Option value="2">2</Option>
                          <Option value="3">3</Option>
                          <Option value="4">4</Option>
                          <Option value="5">5</Option>
                        </Select>
                      </div>
                      <div className="sp-dev__field">
                        {deviceIcon("mobile")}
                        <Select
                          label="Products per row on mobile"
                          labelAccessibilityVisibility="exclusive"
                          value={rp.mobileColumns}
                          onChange={(v) =>
                            setRpKey(
                              "mobileColumns",
                              v as ResultsPageSettings["mobileColumns"],
                            )
                          }
                        >
                          <Option value="1">1</Option>
                          <Option value="2">2</Option>
                        </Select>
                      </div>
                    </div>
                  </div>
                  <div className="sp-dev">
                    <span className="sp-dev__label">Space between cards</span>
                    <div className="sp-rp-pair">
                      <div className="sp-dev__field">
                        {deviceIcon("desktop")}
                        <s-number-field
                          label="Space between cards on desktop"
                          labelAccessibilityVisibility="exclusive"
                          suffix="px"
                          min={0}
                          max={CARD_GAP_MAX}
                          step={1}
                          value={String(rp.cardGap)}
                          onChange={(e) => {
                            const n = Math.round(Number(valueOf(e)));
                            setRpKey(
                              "cardGap",
                              Number.isFinite(n)
                                ? Math.min(CARD_GAP_MAX, Math.max(0, n))
                                : defaultResultsPage().cardGap,
                            );
                          }}
                        />
                      </div>
                      <div className="sp-dev__field">
                        {deviceIcon("mobile")}
                        <s-number-field
                          label="Space between cards on mobile"
                          labelAccessibilityVisibility="exclusive"
                          suffix="px"
                          min={0}
                          max={CARD_GAP_MAX}
                          step={1}
                          value={String(rp.cardGapMobile)}
                          onChange={(e) => {
                            const n = Math.round(Number(valueOf(e)));
                            setRpKey(
                              "cardGapMobile",
                              Number.isFinite(n)
                                ? Math.min(CARD_GAP_MAX, Math.max(0, n))
                                : defaultResultsPage().cardGapMobile,
                            );
                          }}
                        />
                      </div>
                    </div>
                    <s-text color="subdued">
                      {`0–${CARD_GAP_MAX} px, between rows and columns. Mobile: screens under 750 px.`}
                    </s-text>
                  </div>
                </s-stack>
                <s-divider />
                <s-stack gap="base">
                  <s-heading>Paging</s-heading>
                  <div className="sp-rp-pair">
                    <Select
                      label="Rows per page"
                      value={String(
                        Math.min(rp.rowsPerPage, maxRows(Number(rp.columns))),
                      )}
                      onChange={(v) => setRpKey("rowsPerPage", Number(v))}
                    >
                      {Array.from(
                        { length: maxRows(Number(rp.columns)) },
                        (_, i) => (
                          <Option key={i + 1} value={String(i + 1)}>
                            {`${i + 1} ${i ? "rows" : "row"} (${(i + 1) * Number(rp.columns)} products)`}
                          </Option>
                        ),
                      )}
                    </Select>
                    <Select
                      label="Paging style"
                      value={rp.paging}
                      onChange={(v) =>
                        setRpKey("paging", v as ResultsPageSettings["paging"])
                      }
                    >
                      <Option value="pages">Page numbers</Option>
                      <Option value="more">Load more button</Option>
                    </Select>
                  </div>
                </s-stack>
              </s-stack>
            </s-section>
          )}

          {rpSection === "filters" && (
            <s-section accessibilityLabel="Filter settings">
              <SectionTitle icon="filter" gap>
                Filter settings
              </SectionTitle>
              <s-stack gap="large">
                <s-stack gap="base">
                  <s-heading>Filter bar</s-heading>
                  {rp.filters.length === 0 && (
                    <s-banner tone="info">
                      Add a filter group below to see these settings on the page
                      and in the preview. Without filters, the products take the
                      full width.
                    </s-banner>
                  )}
                  <div className="sp-opt-grid">
                    <s-text-field
                      label="Filter bar title"
                      details="Shown above the filters, and on the filter button on mobile."
                      value={rp.filterTitle}
                      maxLength={FILTER_LABEL_MAX}
                      onInput={(e) => setRpKey("filterTitle", valueOf(e))}
                      onBlur={() =>
                        setRpKey(
                          "filterTitle",
                          rp.filterTitle.trim() || "Filters",
                        )
                      }
                    />
                    <Select
                      label="Filter layout"
                      details="On mobile it opens as a drawer."
                      value={rp.filterLayout}
                      onChange={(v) =>
                        setRpKey(
                          "filterLayout",
                          v as ResultsPageSettings["filterLayout"],
                        )
                      }
                    >
                      <Option value="vertical">Vertical (sidebar)</Option>
                      <Option value="horizontal">Horizontal (dropdowns)</Option>
                      <Option value="drawer">Drawer</Option>
                    </Select>
                    {rp.filterLayout === "vertical" && (
                      <Select
                        label="Sidebar position"
                        value={rp.filterSide}
                        onChange={(v) =>
                          setRpKey(
                            "filterSide",
                            v as ResultsPageSettings["filterSide"],
                          )
                        }
                      >
                        <Option value="left">Left</Option>
                        <Option value="right">Right</Option>
                      </Select>
                    )}
                    {rp.filterLayout === "vertical" && (
                      <div className="sp-opt-grid__check sp-dev__field">
                        {deviceIcon("desktop")}
                        <s-checkbox
                          label="Keep the sidebar in view while scrolling"
                          checked={rp.stickySide}
                          onChange={(e) => setRpKey("stickySide", checkedOf(e))}
                        />
                      </div>
                    )}
                  </div>
                </s-stack>
                <s-divider />
                <s-stack gap="base">
                  <s-heading>Filter groups</s-heading>
                  <div>
                    <s-text color="subdued">
                      Group product tags under a name. Shoppers pick a tag to
                      filter. Up to {MAX_FILTERS} groups.
                    </s-text>
                    {rp.filters.length > 0 ? (
                      <div className="sp-rp-list">
                        <div
                          className="sp-rp-row sp-rp-row--head"
                          aria-hidden="true"
                        >
                          <span className="sp-rp-row__n">#</span>
                          <span className="sp-rp-row__t">Filter group</span>
                          <span className="sp-rp-row__a">Actions</span>
                        </div>
                        {rp.filters.map((f, i) => (
                          <div className="sp-rp-row" key={f.id}>
                            <span className="sp-rp-row__n">
                              <s-badge>{i + 1}</s-badge>
                            </span>
                            <div className="sp-rp-row__t">
                              <s-text type="strong">{f.label}</s-text>
                              <s-text color="subdued">
                                {f.tags.length
                                  ? `${f.tags.slice(0, 4).join(", ")}${f.tags.length > 4 ? ` +${f.tags.length - 4} more` : ""}`
                                  : "No tags yet: edit to pick some"}
                              </s-text>
                            </div>
                            <div className="sp-rp-row__a">
                              <s-button
                                variant="tertiary"
                                icon="arrow-up"
                                accessibilityLabel={`Move ${f.label} up`}
                                disabled={i === 0}
                                onClick={() => moveFilter(i, -1)}
                              />
                              <s-button
                                variant="tertiary"
                                icon="arrow-down"
                                accessibilityLabel={`Move ${f.label} down`}
                                disabled={i === rp.filters.length - 1}
                                onClick={() => moveFilter(i, 1)}
                              />
                              <s-button
                                variant="tertiary"
                                icon="edit"
                                accessibilityLabel={`Edit ${f.label}`}
                                onClick={() => openFilter(f)}
                              />
                              <s-button
                                variant="tertiary"
                                tone="critical"
                                icon="delete"
                                accessibilityLabel={`Delete ${f.label}`}
                                onClick={() => askDelete(f)}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <s-box paddingBlockStart="base">
                        <s-text color="subdued">
                          No filter groups yet: shoppers see the {things}{" "}
                          without a filter bar.
                        </s-text>
                      </s-box>
                    )}
                    <s-box paddingBlockStart="base">
                      <s-button
                        icon="plus"
                        disabled={rp.filters.length >= MAX_FILTERS}
                        onClick={() => openFilter(null)}
                      >
                        Add filter group
                      </s-button>
                    </s-box>
                  </div>
                  <div className="sp-opt-grid">
                    {rp.filterLayout !== "horizontal" && (
                      <Select
                        label="Groups when the page loads"
                        details="A group with a picked tag is always open."
                        value={rp.groupsOpen}
                        onChange={(v) =>
                          setRpKey(
                            "groupsOpen",
                            v as ResultsPageSettings["groupsOpen"],
                          )
                        }
                      >
                        <Option value="all">All open</Option>
                        <Option value="first">First open</Option>
                        <Option value="none">All closed</Option>
                      </Select>
                    )}
                    {rp.filterLayout !== "horizontal" && (
                      <Select
                        label="Values shown per filter"
                        value={rp.valuesShown}
                        onChange={(v) =>
                          setRpKey(
                            "valuesShown",
                            v as ResultsPageSettings["valuesShown"],
                          )
                        }
                      >
                        <Option value="5">First 5, then Show more</Option>
                        <Option value="10">First 10, then Show more</Option>
                        <Option value="all">All</Option>
                      </Select>
                    )}
                  </div>
                  <s-checkbox
                    label="Show product count with filter values"
                    checked={rp.showCounts}
                    onChange={(e) => setRpKey("showCounts", checkedOf(e))}
                  />
                </s-stack>
              </s-stack>
            </s-section>
          )}

          {rpSection === "cards" && (
            <s-section accessibilityLabel="Product cards">
              <SectionTitle icon="product" gap>
                Product cards
              </SectionTitle>
              <s-stack gap="large">
                <s-stack gap="base">
                  <s-heading>Image</s-heading>
                  <div className="sp-rp-pair">
                    <Select
                      label="Image shape"
                      value={rp.cardImage}
                      onChange={(v) =>
                        setRpKey(
                          "cardImage",
                          v as ResultsPageSettings["cardImage"],
                        )
                      }
                    >
                      <Option value="square">Square</Option>
                      <Option value="portrait">Portrait (3:4)</Option>
                      <Option value="natural">
                        Natural (the image&apos;s own shape)
                      </Option>
                    </Select>
                    <Select
                      label="Image fit"
                      value={rp.imageFit}
                      onChange={(v) =>
                        setRpKey(
                          "imageFit",
                          v as ResultsPageSettings["imageFit"],
                        )
                      }
                    >
                      <Option value="cover">Fill (crop the edges)</Option>
                      <Option value="contain">Whole image on white</Option>
                    </Select>
                  </div>
                  <s-checkbox
                    label="Show the second image on hover"
                    details="On desktop, for products with more than one image."
                    checked={rp.imageHover}
                    onChange={(e) => setRpKey("imageHover", checkedOf(e))}
                  />
                </s-stack>
                <s-divider />
                <s-stack gap="base">
                  <s-heading>Badges</s-heading>
                  <div className="sp-rp-trio">
                    <Select
                      label="Shape"
                      value={rp.badgeShape}
                      onChange={(v) => setRpKey("badgeShape", v as Shape)}
                    >
                      {shapeOptions}
                    </Select>
                    <s-number-field
                      label="Font size"
                      suffix="px"
                      placeholder="Auto"
                      min={BADGE_SIZE_MIN}
                      max={BADGE_SIZE_MAX}
                      step={1}
                      value={rp.badgeSize ? String(rp.badgeSize) : ""}
                      onChange={(e) => {
                        const v = valueOf(e).trim();
                        const n = Math.round(Number(v));
                        setRpKey(
                          "badgeSize",
                          !v || !Number.isFinite(n)
                            ? 0
                            : Math.min(
                                BADGE_SIZE_MAX,
                                Math.max(BADGE_SIZE_MIN, n),
                              ),
                        );
                      }}
                    />
                    <Select
                      label="Font weight"
                      value={rp.badgeWeight}
                      onChange={(v) =>
                        setRpKey(
                          "badgeWeight",
                          v as ResultsPageSettings["badgeWeight"],
                        )
                      }
                    >
                      <Option value="400">Regular</Option>
                      <Option value="500">Medium</Option>
                      <Option value="600">Semibold</Option>
                      <Option value="700">Bold</Option>
                      <Option value="800">Extra bold</Option>
                    </Select>
                  </div>
                  <s-stack gap="small-200">
                    <div className="sp-rp-list">
                      <div
                        className="sp-rp-row sp-rp-brow sp-rp-row--head"
                        aria-hidden="true"
                      >
                        <span>#</span>
                        <span>Badge</span>
                        <span>Shows when</span>
                        <span>Status</span>
                        <span className="sp-rp-brow__a">Actions</span>
                      </div>
                      {badgeRows.map((row, i) => (
                        <div className="sp-rp-row sp-rp-brow" key={row.key}>
                          <span>
                            <s-badge>{i + 1}</s-badge>
                          </span>
                          <span className="sp-rp-brow__cell">
                            {badgePill(row.badge)}
                          </span>
                          <span className="sp-rp-brow__cell">
                            <s-text color="subdued">{row.when}</s-text>
                          </span>
                          <span>
                            <s-badge tone={row.active ? "success" : "neutral"}>
                              {row.active ? "Active" : "Inactive"}
                            </s-badge>
                          </span>
                          <span className="sp-rp-brow__a">
                            <s-button
                              variant="tertiary"
                              icon="arrow-up"
                              accessibilityLabel={`Move ${row.badge.tag} up`}
                              disabled={!row.up}
                              onClick={row.up ?? undefined}
                            />
                            <s-button
                              variant="tertiary"
                              icon="arrow-down"
                              accessibilityLabel={`Move ${row.badge.tag} down`}
                              disabled={!row.down}
                              onClick={row.down ?? undefined}
                            />
                            <s-switch
                              label={`Show the ${row.badge.tag} badge`}
                              labelAccessibilityVisibility="exclusive"
                              checked={row.active}
                              onChange={(e) => row.toggle(checkedOf(e))}
                            />
                            <s-button
                              variant="tertiary"
                              icon="edit"
                              accessibilityLabel={`Edit ${row.badge.tag}`}
                              onClick={row.edit}
                            />
                            <s-button
                              variant="tertiary"
                              tone="critical"
                              icon="delete"
                              accessibilityLabel={
                                row.remove
                                  ? `Delete ${row.badge.tag}`
                                  : `${row.badge.tag} is built in and can't be deleted`
                              }
                              disabled={!row.remove}
                              onClick={row.remove ?? undefined}
                            />
                          </span>
                        </div>
                      ))}
                    </div>
                    <s-stack direction="inline">
                      <s-button
                        icon="plus"
                        disabled={rp.badgeTags.length >= MAX_BADGE_TAGS}
                        onClick={() => openBadge(null)}
                      >
                        Add badge
                      </s-button>
                    </s-stack>
                    <div className="sp-rp-note">
                      <s-text>
                        <strong>Note:</strong> badges show on the product image,
                        and each card shows{" "}
                        <strong>the first 3 badges that apply</strong>, in the
                        order of this table. <strong>Sold out</strong> and{" "}
                        <strong>Sale</strong> are built in and always come
                        first; move tag badges up or down to choose the rest.
                        Add a badge for any product tag (up to {MAX_BADGE_TAGS}
                        ), and turn one off to hide it without deleting it.
                      </s-text>
                    </div>
                  </s-stack>
                </s-stack>
                <s-divider />
                <s-stack gap="base">
                  <s-heading>Card details</s-heading>
                  <div className="sp-rp-pairs">
                    <Select
                      label="Title length"
                      value={rp.titleLines}
                      onChange={(v) =>
                        setRpKey(
                          "titleLines",
                          v as ResultsPageSettings["titleLines"],
                        )
                      }
                    >
                      <Option value="1">1 line</Option>
                      <Option value="2">2 lines</Option>
                      <Option value="full">Full title</Option>
                    </Select>
                    <div className="sp-opt-grid__check">
                      <s-checkbox
                        label="Show the brand (vendor)"
                        checked={rp.cardVendor}
                        onChange={(e) => setRpKey("cardVendor", checkedOf(e))}
                      />
                    </div>
                    <s-checkbox
                      label="Show the SKU"
                      checked={rp.cardSku}
                      onChange={(e) => setRpKey("cardSku", checkedOf(e))}
                    />
                    <s-checkbox
                      label={`Show the "${s.fitsText}" badge`}
                      checked={rp.cardFit}
                      onChange={(e) => setRpKey("cardFit", checkedOf(e))}
                    />
                    <s-checkbox
                      label="Show the price"
                      checked={rp.cardPrice}
                      onChange={(e) => setRpKey("cardPrice", checkedOf(e))}
                    />
                    <s-checkbox
                      label="Show the compare-at price on sale"
                      checked={rp.cardCompare}
                      onChange={(e) => setRpKey("cardCompare", checkedOf(e))}
                    />
                    {colorField(
                      "Price colour",
                      rp.priceColor,
                      (v) => setRpKey("priceColor", v),
                      "#1A1A1A",
                      false,
                      !rp.cardPrice,
                    )}
                    {colorField(
                      "Compare-at price colour",
                      rp.comparePriceColor,
                      (v) => setRpKey("comparePriceColor", v),
                      "#1A1A1A",
                      false,
                      !rp.cardPrice || !rp.cardCompare,
                    )}
                    <Select
                      label="Text alignment"
                      value={rp.cardAlign}
                      onChange={(v) =>
                        setRpKey(
                          "cardAlign",
                          v as ResultsPageSettings["cardAlign"],
                        )
                      }
                    >
                      <Option value="left">Left</Option>
                      <Option value="center">Center</Option>
                    </Select>
                    <span aria-hidden="true" />
                  </div>
                </s-stack>
                <s-divider />
                <s-stack gap="base">
                  <s-heading>Add to cart button</s-heading>
                  <s-checkbox
                    label="Show the Add to cart button"
                    details="Products with options show Choose options; sold-out ones a disabled Sold out."
                    checked={rp.cardCart}
                    onChange={(e) => setRpKey("cardCart", checkedOf(e))}
                  />
                  {rp.cardCart && (
                    <>
                      <div className="sp-rp-trio">
                        <s-text-field
                          label="Button text"
                          placeholder="Add to cart"
                          value={rp.cartText}
                          maxLength={CART_TEXT_MAX}
                          onInput={(e) => setRpKey("cartText", valueOf(e))}
                        />
                        <Select
                          label="Shape"
                          value={rp.cartShape}
                          onChange={(v) => setRpKey("cartShape", v as Shape)}
                        >
                          {shapeOptions}
                        </Select>
                        <Select
                          label="Style"
                          value={rp.cartStyle}
                          onChange={(v) =>
                            setRpKey(
                              "cartStyle",
                              v as ResultsPageSettings["cartStyle"],
                            )
                          }
                        >
                          <Option value="filled">Filled</Option>
                          <Option value="outline">Outlined</Option>
                        </Select>
                      </div>
                      <div className="sp-rp-trio">
                        {colorField(
                          rp.cartStyle === "outline"
                            ? "Outline and text colour"
                            : "Background colour",
                          rp.cartBg,
                          (v) => setRpKey("cartBg", v),
                          config.s.btn,
                          true,
                        )}
                        {colorField(
                          rp.cartStyle === "outline"
                            ? "Text colour on hover"
                            : "Text colour",
                          rp.cartColor,
                          (v) => setRpKey("cartColor", v),
                          "#FFFFFF",
                          true,
                        )}
                        <span aria-hidden="true" />
                      </div>
                      <s-text color="subdued">
                        {rp.cartStyle === "outline"
                          ? "The colour is used for the outline and text, and fills the button on hover."
                          : "Empty colours use the search widget's button colour and white text. The button darkens a little on hover."}
                      </s-text>
                    </>
                  )}
                </s-stack>
              </s-stack>
            </s-section>
          )}
        </div>
      </div>

      <s-modal
        id={RESULTS_PREVIEW_MODAL}
        accessibilityLabel="Results page preview"
        size="large-100"
        padding="none"
      >
        <div className="sp-rpm">
          <div className="sp-rpm-head">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text type="strong">Results page preview</s-text>
              {liveBadge}
            </s-stack>
            <s-stack direction="inline" gap="small-300" alignItems="center">
              {deviceButton("desktop", "Desktop")}
              {deviceButton("mobile", "Mobile")}
              <s-button
                variant="tertiary"
                icon="x"
                accessibilityLabel="Close preview"
                commandFor={RESULTS_PREVIEW_MODAL}
                command="--hide"
              />
            </s-stack>
          </div>
          <ResultsPreview
            config={previewConfig}
            settings={rp}
            sample={data.results.sample}
            label={data.exampleLabel}
            picks={sample.selections[0] ?? {}}
            widgetCss={
              data.previewAssets.embedCss + data.previewAssets.searchCss
            }
            device={device}
            bare
          />
          {!data.results.sample.length && (
            <s-box padding="base">
              <s-text color="subdued">
                Your active products show here once SpareFit has read them.
              </s-text>
            </s-box>
          )}
        </div>
      </s-modal>

      <s-modal
        id={BADGE_MODAL}
        heading={
          editBuiltin
            ? `Edit the ${badgeDraft.tag} badge`
            : editBadge
              ? "Edit badge"
              : "Add badge"
        }
      >
        <s-stack gap="base">
          {editBuiltin ? (
            <s-text color="subdued">
              {editBuiltin === "soldOut"
                ? "Shows when the product can't be bought."
                : "Shows when the compare-at price is higher than the price."}
            </s-text>
          ) : (
            <TagPicker
              key={pickerKey}
              picked={badgeDraft.tag ? [badgeDraft.tag] : []}
              onChange={(tags) =>
                setBadgeDraft((cur) => ({ ...cur, tag: tags[0] ?? "" }))
              }
              max={1}
              error={badgeError || undefined}
              note="Tags of your active products, most used first (number of products). One tag per badge."
            />
          )}
          {badgeError && badgeDraft.tag && (
            <s-text tone="critical">{badgeError}</s-text>
          )}
          <s-text-field
            label="Label"
            placeholder={badgeDraft.tag || "Tag"}
            details={
              editBuiltin
                ? `Shown on the card instead of "${badgeDraft.tag}". Leave it empty to show "${badgeDraft.tag}".`
                : "Shown on the card instead of the tag. Leave it empty to show the tag."
            }
            value={badgeDraft.label}
            maxLength={BADGE_LABEL_MAX}
            onInput={(e) => {
              // Read the value now: the event is gone when the update runs.
              const label = valueOf(e);
              setBadgeDraft((cur) => ({ ...cur, label }));
            }}
          />
          <div className="sp-rp-pair">
            {colorField(
              "Background",
              badgeDraft.bg,
              (v) => setBadgeDraft((cur) => ({ ...cur, bg: v })),
              BADGE_TAG_COLORS.bg,
            )}
            {colorField(
              "Text colour",
              badgeDraft.color,
              (v) => setBadgeDraft((cur) => ({ ...cur, color: v })),
              BADGE_TAG_COLORS.color,
            )}
          </div>
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text color="subdued">Preview</s-text>
            {badgePill({ ...badgeDraft, tag: badgeDraft.tag || "Tag" })}
          </s-stack>
        </s-stack>
        <s-button slot="primary-action" variant="primary" onClick={saveBadge}>
          {editBadge || editBuiltin ? "Done" : "Add badge"}
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor={BADGE_MODAL}
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>

      <s-modal
        id={BADGE_DELETE_MODAL}
        heading={`Delete the ${deletingBadge?.tag ?? ""} badge?`}
        size="small"
      >
        <s-paragraph>
          Products keep the tag; the badge no longer shows on their cards.
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          onClick={deleteBadge}
        >
          Delete badge
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor={BADGE_DELETE_MODAL}
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>

      <s-modal
        id={FILTER_MODAL}
        heading={editFilter ? "Edit filter group" : "Add filter group"}
      >
        <s-stack gap="base">
          <s-text-field
            label="Group name"
            details="What shoppers see above the tags, e.g. Brand"
            value={fLabel}
            maxLength={FILTER_LABEL_MAX}
            error={fErrors.label}
            onInput={(e) => setFLabel(valueOf(e))}
          />
          <TagPicker
            key={pickerKey}
            picked={fTags}
            onChange={setFTags}
            max={MAX_GROUP_TAGS}
            error={fErrors.tags}
            note={`Tags of your active products, most used first (number of products). Up to ${MAX_GROUP_TAGS} tags per group.`}
          />
        </s-stack>
        <s-button slot="primary-action" variant="primary" onClick={saveFilter}>
          {editFilter ? "Done" : "Add group"}
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor={FILTER_MODAL}
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>

      <s-modal
        id={FILTER_DELETE_MODAL}
        heading={`Delete the ${deleting?.label ?? ""} filter group?`}
        size="small"
      >
        <s-paragraph>
          Shoppers will no longer see it on the results page. Your product tags
          stay as they are.
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          onClick={deleteFilter}
        >
          Delete group
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor={FILTER_DELETE_MODAL}
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>
    </>
  );

  return (
    <s-page inlineSize="base">
      {/* App Bridge save bar: the primary button is Save, the other one Discard. */}
      <SaveBar id={SAVE_BAR} open={dirty} discardConfirmation>
        <button
          variant="primary"
          loading={saving ? "" : undefined}
          onClick={() => void saveAll()}
        >
          Save
        </button>
        <button disabled={saving} onClick={discard}>
          Discard
        </button>
      </SaveBar>
      <PageHeader title="Storefront" />
      <s-stack gap="base">
        {publishFailed && (
          <s-banner
            tone="warning"
            heading="Your theme doesn't have the latest settings yet"
          >
            SpareFit couldn&apos;t send your changes to the theme.
            <s-button slot="secondary-actions" onClick={retryPublish}>
              Try again
            </s-button>
          </s-banner>
        )}
        {liveStatus && !liveStatus.embedOn && (
          <s-banner
            tone="critical"
            heading="SpareFit is turned off in your live theme"
          >
            Shoppers don&apos;t see My Selection or the fitment table shortcode,
            and blocks can&apos;t be added, until you turn on the app embed in
            Theme integration.
            {tab !== "theme" && (
              <s-button
                slot="secondary-actions"
                onClick={() => showTab("theme")}
              >
                Open Theme integration
              </s-button>
            )}
          </s-banner>
        )}
        <div
          className="sp-tabs"
          role="tablist"
          aria-label="Storefront"
          ref={tabsRef}
        >
          {TABS.map(([k, label, icon]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
            >
              <Icon name={icon} size={16} />
              {label}
            </button>
          ))}
        </div>
        {tab === "theme" && themeCard}
        {tab === "widget" && widgetTab}
        {tab === "results" && resultsTab}
        {tab === "badge" && badgeTab}
        {tab === "table" && tableTab}
        {tab === "garage" && garageTab}
      </s-stack>
    </s-page>
  );
}
