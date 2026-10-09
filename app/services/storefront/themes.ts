// Theme integration (specs/storefront.md › Theme integration): what FitFinder has in a theme and
// the theme editor deep links. Pure; the GraphQL side is themes.server.ts.
//
// Detection (https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration
// › Detecting app blocks and app embed blocks): our blocks appear with the type
// "shopify://apps/{app}/blocks/{handle}/{id}" in config/settings_data.json (app embed, with a
// `disabled` flag; present only after it was enabled once) and in the JSON templates / section
// groups (app blocks). Block handles are the Liquid file names; they all start with "fitfinder-"
// so another app's "search" or "app-embed" block can't be mistaken for ours.

export const BLOCK_HANDLES = {
  search: "fitfinder-search",
  badge: "fitfinder-fits-badge",
  table: "fitfinder-fitment-table",
  embed: "fitfinder-embed",
} as const;

export type BlockKey = "search" | "badge" | "table";

export const TABLE_CODE = "[fitfinder-table]";

/** Files the status check reads (wildcards are allowed in `files(filenames:)`). */
export const THEME_FILE_PATTERNS = [
  "config/settings_data.json",
  "templates/*.json",
  "sections/*.json",
];

export interface ThemeFile {
  filename: string;
  content: string;
}

export interface ThemeStatusView {
  embedOn: boolean;
  /** Where each block was found: the template name ("index", "product.alt") or "" for a section group; absent = not added. */
  blocks: Partial<Record<BlockKey, string>>;
  tableCodeFound: boolean;
  /** The section each block sits in, as the theme editor names it ("Product information"). */
  sections?: Partial<Record<BlockKey, string>>;
}

/** The section a block of ours was found in: its type, and the merchant's own name for it. */
export interface BlockSection {
  type: string;
  name?: string;
}

/** JSON theme files may start with a comment block (Shopify adds one to generated files). */
export function parseThemeJson(content: string): unknown {
  const body = content.replace(/^\s*\/\*[\s\S]*?\*\//, "");
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

const HANDLE_OF = new Map<string, keyof typeof BLOCK_HANDLES>(
  Object.entries(BLOCK_HANDLES).map(([k, h]) => [
    h,
    k as keyof typeof BLOCK_HANDLES,
  ]),
);

/** "shopify://apps/x/blocks/fitfinder-search/uid" → "search"; other blocks → null. */
export function ourBlock(type: unknown): keyof typeof BLOCK_HANDLES | null {
  if (typeof type !== "string") return null;
  const m = /^shopify:\/\/apps\/[^/]+\/blocks\/([^/]+)\/[^/]+$/.exec(type);
  return (m && HANDLE_OF.get(m[1])) || null;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Every enabled block of ours inside a template or section group (nested blocks included), with
 * the section it sits in (the first one, when a block appears more than once).
 */
function blocksIn(doc: unknown): Map<keyof typeof BLOCK_HANDLES, BlockSection> {
  const found = new Map<keyof typeof BLOCK_HANDLES, BlockSection>();
  const walkBlocks = (blocks: unknown, section: BlockSection) => {
    if (!isObject(blocks)) return;
    for (const b of Object.values(blocks)) {
      if (!isObject(b) || b.disabled === true) continue;
      const mine = ourBlock(b.type);
      if (mine && !found.has(mine)) found.set(mine, section);
      walkBlocks(b.blocks, section);
    }
  };
  if (!isObject(doc) || !isObject(doc.sections)) return found;
  for (const section of Object.values(doc.sections)) {
    if (!isObject(section) || section.disabled === true) continue;
    const type = typeof section.type === "string" ? section.type : "";
    const name =
      typeof section.name === "string" && section.name.trim()
        ? section.name.trim()
        : undefined;
    walkBlocks(section.blocks, { type, name });
  }
  return found;
}

/** settings_data.json: `current` is the settings object, or the name of a preset in `presets`. */
function currentSettings(doc: unknown): Json | null {
  if (!isObject(doc)) return null;
  const current = doc.current;
  if (isObject(current)) return current;
  if (typeof current === "string" && isObject(doc.presets)) {
    const preset = doc.presets[current];
    return isObject(preset) ? preset : null;
  }
  return null;
}

const TEMPLATE = /^templates\/(.+)\.json$/;
const PRODUCT_TEMPLATE = /^templates\/product(\.[^/]+)?\.json$/;

export function analyzeTheme(files: ThemeFile[]): ThemeStatusView & {
  /** Where each found block sits, for sectionLabel(). */
  blockSections: Partial<Record<BlockKey, BlockSection>>;
} {
  const view: ThemeStatusView & {
    blockSections: Partial<Record<BlockKey, BlockSection>>;
  } = {
    embedOn: false,
    blocks: {},
    tableCodeFound: false,
    blockSections: {},
  };
  // Templates first (so "View in editor" opens a template), section groups after.
  const ordered = [...files].sort(
    (a, b) =>
      Number(!TEMPLATE.test(a.filename)) - Number(!TEMPLATE.test(b.filename)),
  );
  for (const file of ordered) {
    if (file.filename === "config/settings_data.json") {
      const blocks = currentSettings(parseThemeJson(file.content))?.blocks;
      if (isObject(blocks)) {
        view.embedOn = Object.values(blocks).some(
          (b) =>
            isObject(b) && ourBlock(b.type) === "embed" && b.disabled !== true,
        );
      }
      continue;
    }
    const template = TEMPLATE.exec(file.filename);
    const isGroup = file.filename.startsWith("sections/");
    if (!template && !isGroup) continue;
    if (
      file.content.includes(TABLE_CODE) &&
      (PRODUCT_TEMPLATE.test(file.filename) || isGroup)
    ) {
      view.tableCodeFound = true;
    }
    for (const [key, section] of blocksIn(parseThemeJson(file.content))) {
      if (key === "embed" || key in view.blocks) continue;
      view.blocks[key] = template ? template[1] : "";
      view.blockSections[key] = section;
    }
  }
  return view;
}

/** "main-product" → "Main product" (when the theme's own name can't be read). */
const humanize = (type: string) => {
  const t = type.replace(/[-_]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
};

/** The schema name in a section's Liquid file ("Product information" or "t:sections.x.name"). */
export function schemaName(liquid: string | undefined): string | null {
  if (!liquid) return null;
  const m = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/.exec(
    liquid,
  );
  if (!m) return null;
  const schema = parseThemeJson(m[1]);
  return isObject(schema) && typeof schema.name === "string"
    ? schema.name
    : null;
}

/**
 * The section's name as the theme editor shows it: the merchant's own name, else the section's
 * schema name (a "t:" key is looked up in the theme's en.default.schema.json), else its type.
 */
export function sectionLabel(
  section: BlockSection,
  liquid: string | undefined,
  schemaLocale: unknown,
): string {
  if (section.name) return section.name;
  const name = schemaName(liquid);
  if (name && !name.startsWith("t:")) return name;
  if (name) {
    let v: unknown = schemaLocale;
    for (const part of name.slice(2).split(".")) {
      v = isObject(v) ? v[part] : undefined;
    }
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return humanize(section.type);
}

// ---------------------------------------------------------------- themes and deep links

export type ThemeRole = "MAIN" | "UNPUBLISHED" | "DEVELOPMENT";

export interface ThemeItem {
  /** Numeric theme id (as in admin URLs). */
  id: string;
  name: string;
  role: ThemeRole;
}

const ROLE_LABEL: Record<ThemeRole, string> = {
  MAIN: "live theme",
  UNPUBLISHED: "draft",
  DEVELOPMENT: "development",
};

/** "Dawn (live theme)", "Refresh (draft)". */
export const themeLabel = (t: ThemeItem) => `${t.name} (${ROLE_LABEL[t.role]})`;

/** gid://shopify/OnlineStoreTheme/123 → "123". */
export const themeNumericId = (gid: string) => gid.split("/").pop() ?? "";

/** Live theme first, then drafts and development themes by name. */
export function sortThemes(themes: ThemeItem[]): ThemeItem[] {
  const rank: Record<ThemeRole, number> = {
    MAIN: 0,
    UNPUBLISHED: 1,
    DEVELOPMENT: 2,
  };
  return [...themes].sort(
    (a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name),
  );
}

/**
 * Theme editor links (configuration docs › Deep linking): the app embed is activated with
 * `context=apps&activateAppId={api_key}/{handle}`; app blocks are added with
 * `addAppBlockId={api_key}/{handle}&target=…` (newAppsSection on any JSON template; mainSection =
 * the product template's main section). Shop = the myshopify domain.
 */
export function editorLinks(shop: string, themeId: string, apiKey: string) {
  const base = `https://${shop}/admin/themes/${encodeURIComponent(themeId)}/editor`;
  const q = (params: Record<string, string>) =>
    `${base}?${new URLSearchParams(params)}`;
  const add = (key: BlockKey, template: string, target: string) =>
    q({ template, addAppBlockId: `${apiKey}/${BLOCK_HANDLES[key]}`, target });
  return {
    editor: base,
    embedOn: q({
      context: "apps",
      activateAppId: `${apiKey}/${BLOCK_HANDLES.embed}`,
    }),
    embedPanel: q({ context: "apps" }),
    add: {
      search: add("search", "index", "newAppsSection"),
      badge: add("badge", "product", "mainSection"),
      table: add("table", "product", "mainSection"),
    } satisfies Record<BlockKey, string>,
    /** Opens the template the block was found in ("" = a section group: the editor's start page). */
    view: (template: string) => (template ? q({ template }) : base),
    product: q({ template: "product" }),
  };
}

/**
 * The store hasn't granted read_themes (the scope was added after it installed the app). The
 * Admin API client may throw a generic GraphqlQueryError with the ACCESS_DENIED details in its
 * body, or gqlData throws its own error with them in the message: look at both.
 */
export function isThemeAccessError(error: unknown): boolean {
  const parts = [String(error)];
  try {
    parts.push(
      JSON.stringify((error as { body?: unknown } | null)?.body ?? ""),
    );
  } catch {
    // circular body: the message alone decides
  }
  return /ACCESS_DENIED|read_themes/.test(parts.join(" "));
}
