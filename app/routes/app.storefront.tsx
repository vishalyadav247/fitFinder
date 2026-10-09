// Storefront: theme integration (app embed and blocks per theme, theme editor deep links) and the
// settings of the shopper-facing blocks with live previews. Changes collect in a draft (the
// previews follow it) behind the App Bridge save bar; Save sends them all at once and publishes
// the result to the theme (app metafield).
// Spec: .claude/specs/storefront.md · Prototype: .claude/design/scripts/screens/storefront.js
import { useCallback, useEffect, useRef, useState } from "react";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
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

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

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
  return {
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
    exampleLabel: first
      ? selectionLabel(fieldTypes, new Map(Object.entries(first)))
      : "",
  };
};

type Tab = "widget" | "badge" | "table" | "garage";
// Line icons (they follow the text colour: white on the active tab), like the section titles.
const TABS: [Tab, string, IconName][] = [
  ["widget", "Search widget", "search"],
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
  "saveText",
  "tableEmptyText",
  "tableTitle",
]);
const open = (url: string) => window.open(url, "_blank", "noopener");

export default function StorefrontPage() {
  const data = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { config, sample } = data;

  // What the server has (saved) and the draft shown in the fields and previews (s, heading). The
  // save bar shows while they differ.
  const [saved, setSaved] = useState<StorefrontSettings>(config.s);
  const [s, setS] = useState<StorefrontSettings>(config.s);
  const [savedHeading, setSavedHeading] = useState(config.heading);
  const [heading, setHeading] = useState(config.heading);
  const [saving, setSaving] = useState(false);
  const [publishFailed, setPublishFailed] = useState(data.publishFailed);
  const [tab, setTab] = useState<Tab>(
    (TABS.find(([k]) => k === params.get("tab"))?.[0] as Tab) ?? "widget",
  );
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
  const dirty = changedKeys.length > 0 || heading.trim() !== savedHeading;

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
    setPublishFailed(r.published === false);
    shopify.toast.show("Settings saved");
  };

  const discard = () => {
    setS(saved);
    setHeading(savedHeading);
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

  const statusCell = (row: Row) => {
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

  const themeCard = (
    <s-section padding="none" accessibilityLabel="Theme integration">
      <s-box padding="base" paddingBlockEnd="none">
        <SectionTitle icon="theme">Theme integration</SectionTitle>
      </s-box>
      {data.themesError === "access" && (
        <s-box padding="base">
          <s-banner
            tone="warning"
            heading="FitFinder needs access to your themes"
          >
            FitFinder checks your themes to show whether its blocks and app
            embed are added. Open FitFinder from your apps list and approve the
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
              gridTemplateColumns="minmax(0, 320px) 1fr auto"
              gap="large"
              alignItems="end"
            >
              <s-select
                label="Theme"
                value={themeId}
                onChange={(e) => pickTheme(valueOf(e))}
              >
                {data.themes.map((t) => (
                  <s-option key={t.id} value={t.id}>
                    {themeLabel(t)}
                  </s-option>
                ))}
              </s-select>
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
                        ? "Theme editor opened. Turn on FitFinder there and save."
                        : "Theme editor opened. Turn off FitFinder there and save.",
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
          <s-banner tone="info" heading={`${theme.name} isn't your live theme`}>
            You can set FitFinder up here now. Shoppers see it once you publish
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
    </s-section>
  );

  // ---------------------------------------------------------------- tabs
  const liveBadge = (
    <s-badge tone="success" icon="view">
      Live preview
    </s-badge>
  );
  const previewNote = (note: string) => (
    <div className="ff-pv-head">
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

  const widgetTab = (
    <>
      <s-section accessibilityLabel="Live preview">
        <div className="ff-pv-head">
          {liveBadge}
          <s-stack direction="inline" gap="small-300">
            {deviceButton("desktop", "Desktop")}
            {deviceButton("mobile", "Mobile")}
          </s-stack>
        </div>
        <div
          className={`ff-pv-stage${device === "mobile" ? " is-mobile" : ""}`}
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
      <s-section accessibilityLabel="Layout and style">
        <SectionTitle icon="paint-brush-flat" gap>
          Layout and style
        </SectionTitle>
        <div className="ff-opt-grid">
          <s-select
            label="Layout"
            details="On phones the dropdowns always stack."
            value={s.layout}
            onChange={(e) =>
              save("layout", valueOf(e) as StorefrontSettings["layout"])
            }
          >
            <s-option value="bar">Horizontal (one row)</s-option>
            <s-option value="card">Vertical (stacked)</s-option>
          </s-select>
          <s-select
            label="Corners"
            value={s.corners}
            onChange={(e) =>
              save("corners", valueOf(e) as StorefrontSettings["corners"])
            }
          >
            <s-option value="square">Square</s-option>
            <s-option value="rounded">Rounded</s-option>
            <s-option value="pill">Pill</s-option>
          </s-select>
        </div>
        <s-box paddingBlockStart="base">
          <div className="ff-opt-grid ff-three">
            {(
              [
                ["btn", "Button colour"],
                ["bg", "Background"],
                ["text", "Text colour"],
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
          </div>
        </s-box>
        <s-box paddingBlockStart="base">
          <s-checkbox
            label="Show labels above the dropdowns"
            details="Off: the field name is shown inside each dropdown instead."
            checked={s.labels}
            onChange={(e) => save("labels", checkedOf(e))}
          />
        </s-box>
      </s-section>
      <s-grid
        gridTemplateColumns="minmax(0, 2fr) minmax(0, 1fr)"
        gap="base"
        alignItems="start"
      >
        <s-section accessibilityLabel="Text">
          <SectionTitle icon="text" gap>
            Text
          </SectionTitle>
          <s-stack gap="base">
            <s-stack gap="small-200">
              <s-text-field
                label="Search heading"
                value={heading}
                maxLength={200}
                onInput={(e) => setHeading(valueOf(e))}
              />
              <s-checkbox
                label="Show search heading"
                checked={s.showHeading}
                onChange={(e) => save("showHeading", checkedOf(e))}
              />
            </s-stack>
            <s-text-field
              label="Button text"
              maxLength={200}
              {...textProps("button")}
            />
            <s-text-field
              label="Save link text"
              maxLength={200}
              {...textProps("saveText")}
            />
            <s-box>
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text color="subdued">
                  Dropdowns and their placeholder text come from your search
                  fields:
                </s-text>
                {config.fields.map((f) => (
                  <s-chip key={f.id}>{f.label}</s-chip>
                ))}
                <s-link
                  onClick={() =>
                    void leave(() => navigate("/app/search-setup"))
                  }
                >
                  Edit fields
                </s-link>
              </s-stack>
            </s-box>
          </s-stack>
        </s-section>
        <s-section accessibilityLabel="Behaviour">
          <SectionTitle icon="settings" gap>
            Behaviour
          </SectionTitle>
          <s-stack gap="small">
            <s-checkbox
              label={`Show “${live.saveText}”`}
              checked={s.saveLink}
              onChange={(e) => save("saveLink", checkedOf(e))}
            />
            <s-checkbox
              label="Show a reset link"
              checked={s.reset}
              onChange={(e) => save("reset", checkedOf(e))}
            />
          </s-stack>
        </s-section>
      </s-grid>
    </>
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
        <s-stack gap="base">
          <s-stack gap="small-300">
            <p className="ff-grp-t">Before a selection</p>
            <s-text-field
              label="Text"
              maxLength={200}
              {...textProps("askText")}
            />
          </s-stack>
          <s-divider />
          <s-stack gap="small-300">
            <p className="ff-grp-t">When it fits</p>
            <s-text-field
              label="Text"
              maxLength={200}
              {...textProps("fitsText")}
            />
          </s-stack>
          <s-divider />
          <s-stack gap="small-300">
            <p className="ff-grp-t">When it doesn&apos;t fit</p>
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
        <s-stack gap="base">
          <s-stack gap="small-300">
            <p className="ff-grp-t">Where to show it</p>
            <s-select
              label="Show the table"
              labelAccessibilityVisibility="exclusive"
              value={s.tablePlace}
              onChange={(e) =>
                save(
                  "tablePlace",
                  valueOf(e) as StorefrontSettings["tablePlace"],
                )
              }
            >
              <s-option value="block">Use as block</s-option>
              <s-option value="tabs">Use as shortcode</s-option>
            </s-select>
            {inTabs ? (
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack gap="small-300">
                  <s-text type="strong">Add the shortcode in 3 steps</s-text>
                  <ol className="ff-steps">
                    <li>
                      In the theme editor, open a product page and pick where
                      the table should go: any spot that shows text, such as a
                      text or Custom Liquid block, a collapsible row or a tab.
                    </li>
                    <li>
                      Paste this shortcode there:
                      <span className="ff-code-row">
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
                      Save. FitFinder replaces the shortcode with the table on
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
            <p className="ff-grp-t">Display</p>
            {!inTabs && (
              <>
                <s-select
                  label="Show as"
                  value={s.tableStyle}
                  onChange={(e) =>
                    save(
                      "tableStyle",
                      valueOf(e) as StorefrontSettings["tableStyle"],
                    )
                  }
                >
                  <s-option value="collapsible">Collapsible row</s-option>
                  <s-option value="open">Open table</s-option>
                </s-select>
                <s-text-field
                  label="Title"
                  maxLength={200}
                  {...textProps("tableTitle")}
                />
                {s.tableStyle === "collapsible" && (
                  <s-checkbox
                    label="Start expanded"
                    checked={s.tableOpen}
                    onChange={(e) => save("tableOpen", checkedOf(e))}
                  />
                )}
              </>
            )}
            <s-select
              label="Table style"
              value={s.tableLook}
              onChange={(e) =>
                save("tableLook", valueOf(e) as StorefrontSettings["tableLook"])
              }
            >
              <s-option value="lines">Lines between rows</s-option>
              <s-option value="striped">Striped rows</s-option>
              <s-option value="plain">Plain</s-option>
            </s-select>
            {inTabs && (
              <s-text color="subdued">
                The shortcode shows just the table. Add a heading above it in
                your theme if you want one.
              </s-text>
            )}
          </s-stack>
          <s-divider />
          <s-stack gap="small-300">
            <p className="ff-grp-t">Columns</p>
            <s-text color="subdued">
              One column per search field, in the same order as Search setup.
            </s-text>
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
          <s-divider />
          <s-stack gap="small-300">
            <p className="ff-grp-t">Rows</p>
            <s-grid
              gridTemplateColumns="minmax(0, 1fr) minmax(0, 1fr)"
              gap="base"
              alignItems="end"
            >
              <s-select
                label="Sort by"
                value={s.tableSort}
                onChange={(e) =>
                  save(
                    "tableSort",
                    valueOf(e) as StorefrontSettings["tableSort"],
                  )
                }
              >
                <s-option value="fields">Search field order (A–Z)</s-option>
                {yearField && (
                  <s-option value="year">
                    Newest {yearField.label.toLowerCase()} first
                  </s-option>
                )}
              </s-select>
              <s-select
                label="Rows before “Show all”"
                value={s.tableRows}
                onChange={(e) =>
                  save(
                    "tableRows",
                    valueOf(e) as StorefrontSettings["tableRows"],
                  )
                }
              >
                <s-option value="5">5</s-option>
                <s-option value="10">10</s-option>
                <s-option value="all">All</s-option>
              </s-select>
            </s-grid>
          </s-stack>
          <s-divider />
          <s-stack gap="small-300">
            <p className="ff-grp-t">When a product has no rows</p>
            <s-select
              label="Show"
              labelAccessibilityVisibility="exclusive"
              value={s.tableEmpty}
              onChange={(e) =>
                save(
                  "tableEmpty",
                  valueOf(e) as StorefrontSettings["tableEmpty"],
                )
              }
            >
              <s-option value="hide">Hide the table</s-option>
              <s-option value="text">Show a text instead</s-option>
            </s-select>
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
        {status && !embed && (
          <s-box paddingBlockEnd="base">
            <s-banner
              tone="warning"
              heading="Turn on the app embed to show the button"
            >
              The button is part of the app embed in Theme integration.
            </s-banner>
          </s-box>
        )}
        {embed && !s.garage && (
          <s-box paddingBlockEnd="base">
            <s-banner tone="info" heading="My Selection is turned off">
              Turn it on with its switch in Theme integration above. You can
              still set it up here.
            </s-banner>
          </s-box>
        )}
        <s-box paddingBlockStart="base">
          <div className="ff-opt-grid ff-one">
            <s-text-field
              label="Name shoppers see"
              details="For example My Selection, My Garage or My Devices."
              maxLength={200}
              {...textProps("garageName")}
            />
            <s-select
              label="Position"
              value={s.savedPos}
              onChange={(e) =>
                save("savedPos", valueOf(e) as StorefrontSettings["savedPos"])
              }
            >
              <s-option value="right-middle">
                Right edge, middle (vertical tab)
              </s-option>
              <s-option value="left-middle">
                Left edge, middle (vertical tab)
              </s-option>
              <s-option value="bottom-right">Bottom right</s-option>
              <s-option value="bottom-left">Bottom left</s-option>
            </s-select>
            <s-select
              label="Icon"
              value={s.savedIcon}
              onChange={(e) =>
                save("savedIcon", valueOf(e) as StorefrontSettings["savedIcon"])
              }
            >
              <s-option value="star">Star</s-option>
              <s-option value="heart">Heart</s-option>
              <s-option value="bookmark">Bookmark</s-option>
              <s-option value="clock">Clock (recent)</s-option>
              <s-option value={data.storeIcon}>{nounLabel}</s-option>
              <s-option value="custom">Custom (upload your own)</s-option>
              <s-option value="none">No icon</s-option>
            </s-select>
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
            <s-select
              label="Saved selections per shopper"
              value={s.maxSaved}
              onChange={(e) =>
                save("maxSaved", valueOf(e) as StorefrontSettings["maxSaved"])
              }
            >
              <s-option value="3">3</s-option>
              <s-option value="5">5</s-option>
              <s-option value="10">10</s-option>
            </s-select>
            <s-checkbox
              label="Show saved selection count"
              checked={s.savedCount}
              onChange={(e) => save("savedCount", checkedOf(e))}
            />
          </div>
        </s-box>
        <s-box paddingBlockStart="base">
          <s-checkbox
            label="Ask shoppers to save their selection after a search"
            checked={s.askSave}
            onChange={(e) => save("askSave", checkedOf(e))}
          />
        </s-box>
      </s-section>
      <s-section accessibilityLabel="Live preview">
        {previewNote(
          "Hover the tab or click it to try it. Looks the same on desktop and mobile.",
        )}
        <div className="ff-mini-win">
          <div className="ff-mw-bar">
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
      <PageHeader title="Storefront">
        <s-button
          variant="primary"
          icon="external"
          disabled={!themeId}
          onClick={() => open(links.editor)}
        >
          Open theme editor
        </s-button>
      </PageHeader>
      <s-stack gap="base">
        {publishFailed && (
          <s-banner
            tone="warning"
            heading="Your theme doesn't have the latest settings yet"
          >
            FitFinder couldn&apos;t send your changes to the theme.
            <s-button slot="secondary-actions" onClick={retryPublish}>
              Try again
            </s-button>
          </s-banner>
        )}
        {liveStatus && !liveStatus.embedOn && (
          <s-banner
            tone="critical"
            heading="FitFinder is turned off in your live theme"
          >
            Shoppers don&apos;t see My Selection or the fitment table shortcode,
            and blocks can&apos;t be added, until you turn on the app embed in
            Theme integration.
          </s-banner>
        )}
        {themeCard}
        <div
          className="ff-tabs"
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
        {tab === "widget" && widgetTab}
        {tab === "badge" && badgeTab}
        {tab === "table" && tableTab}
        {tab === "garage" && garageTab}
      </s-stack>
    </s-page>
  );
}
