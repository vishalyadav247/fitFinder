// Theme integration, Admin GraphQL side: the shop's themes and what FitFinder has in one of them
// (themes.ts analyses the files). Needs read_themes. The result is cached in theme_status
// (the Dashboard reads the live theme's embed state from there in M9).
// Docs: https://shopify.dev/docs/api/admin-graphql/2026-10/queries/themes,
// https://shopify.dev/docs/api/admin-graphql/2026-10/queries/theme (files(filenames:) with *).
import prisma from "../../db.server";
import { gqlData, type AdminGraphql } from "../linking/catalog.server";
import {
  analyzeTheme,
  sortThemes,
  THEME_FILE_PATTERNS,
  themeNumericId,
  type ThemeFile,
  type ThemeItem,
  type ThemeRole,
  type ThemeStatusView,
} from "./themes";

const THEMES = `#graphql
  query StorefrontThemes {
    themes(first: 20, roles: [MAIN, UNPUBLISHED, DEVELOPMENT]) {
      nodes { id name role }
    }
  }`;

const THEME_FILES = `#graphql
  query ThemeFiles($id: ID!, $filenames: [String!]!, $after: String) {
    theme(id: $id) {
      id
      files(filenames: $filenames, first: 50, after: $after) {
        nodes {
          filename
          body {
            ... on OnlineStoreThemeFileBodyText { content }
            ... on OnlineStoreThemeFileBodyBase64 { contentBase64 }
            ... on OnlineStoreThemeFileBodyUrl { url }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;

interface FileBody {
  content?: string;
  contentBase64?: string;
  url?: string;
}

// Big files may come back as a download URL (Shopify only says the body is one of three kinds).
const MAX_FILE_BYTES = 5_000_000;

async function bodyText(body: FileBody | null): Promise<string | null> {
  if (!body) return null;
  if (typeof body.content === "string") return body.content;
  if (typeof body.contentBase64 === "string") {
    return Buffer.from(body.contentBase64, "base64").toString("utf8");
  }
  if (body.url?.startsWith("https://")) {
    const res = await fetch(body.url, { signal: AbortSignal.timeout(10_000) });
    const length = Number(res.headers.get("content-length") ?? 0);
    if (!res.ok || length > MAX_FILE_BYTES) return null;
    const text = await res.text();
    return text.length > MAX_FILE_BYTES ? null : text;
  }
  return null;
}

interface ThemeFilesData {
  theme: {
    files: {
      nodes: { filename: string; body: FileBody | null }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    } | null;
  } | null;
}

// A theme has a few dozen JSON templates at most; stop paging well past that.
const MAX_PAGES = 10;

export class ThemeNotFoundError extends Error {
  constructor() {
    super("That theme no longer exists.");
    this.name = "ThemeNotFoundError";
  }
}

export async function listThemes(gql: AdminGraphql): Promise<ThemeItem[]> {
  const { themes } = await gqlData<{
    themes: { nodes: { id: string; name: string; role: ThemeRole }[] };
  }>(gql, THEMES);
  return sortThemes(
    themes.nodes.map((t) => ({
      id: themeNumericId(t.id),
      name: t.name,
      role: t.role,
    })),
  );
}

async function themeFiles(
  gql: AdminGraphql,
  themeId: string,
): Promise<ThemeFile[]> {
  const files: ThemeFile[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { theme }: ThemeFilesData = await gqlData<ThemeFilesData>(
      gql,
      THEME_FILES,
      {
        id: `gid://shopify/OnlineStoreTheme/${themeId}`,
        filenames: THEME_FILE_PATTERNS,
        after,
      },
    );
    if (!theme) throw new ThemeNotFoundError();
    if (!theme.files) break;
    for (const node of theme.files.nodes) {
      const content = await bodyText(node.body);
      if (content !== null) files.push({ filename: node.filename, content });
    }
    if (!theme.files.pageInfo.hasNextPage) break;
    if (page === MAX_PAGES - 1) {
      console.warn("themes: stopped reading theme files at the page cap", {
        themeId,
      });
    }
    after = theme.files.pageInfo.endCursor;
  }
  return files;
}

/** Reads the theme's files, works out the status and caches it for the shop. */
export async function readThemeStatus(
  gql: AdminGraphql,
  shopId: string,
  themeId: string,
): Promise<ThemeStatusView> {
  const status = analyzeTheme(await themeFiles(gql, themeId));
  const row = {
    embedOn: status.embedOn,
    blocks: status.blocks,
    tableCodeFound: status.tableCodeFound,
    checkedAt: new Date(),
  };
  await prisma.themeStatus.upsert({
    where: { shopId_themeId: { shopId, themeId } },
    create: { shopId, themeId, ...row },
    update: row,
  });
  return status;
}
