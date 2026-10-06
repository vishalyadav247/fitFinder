// Uploads a My Selection icon to Shopify Files (specs/storefront.md: stagedUploadsCreate →
// fileCreate, save the URL). PNG becomes an image (MediaImage), SVG a generic file. Needs
// write_files. Files are processed asynchronously: poll until READY.
// Docs: https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/stagedUploadsCreate,
// https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/fileCreate,
// https://shopify.dev/docs/apps/build/product-merchandising/products-and-collections/manage-media
import {
  gqlData,
  ShopifyApiError,
  type AdminGraphql,
} from "../linking/catalog.server";
import type { IconCheck } from "./icon";

const STAGE = `#graphql
  mutation StageIcon($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }`;

const CREATE = `#graphql
  mutation CreateIconFile($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id fileStatus }
      userErrors { field message }
    }
  }`;

const FILE = `#graphql
  query IconFile($id: ID!) {
    node(id: $id) {
      ... on MediaImage { fileStatus image { url } }
      ... on GenericFile { fileStatus url }
    }
  }`;

const POLLS = 15;
const POLL_MS = 1000;

type Ok = Extract<IconCheck, { ok: true }>;

/** Returns the file's https URL on Shopify's CDN. */
export async function uploadIcon(
  gql: AdminGraphql,
  bytes: Uint8Array,
  icon: Ok,
  { pollMs = POLL_MS, upload = fetch } = {},
): Promise<string> {
  const filename = `fitfinder-my-selection-icon.${icon.extension}`;
  const resource = icon.kind === "png" ? "IMAGE" : "FILE";
  const { stagedUploadsCreate } = await gqlData<{
    stagedUploadsCreate: {
      stagedTargets: {
        url: string;
        resourceUrl: string;
        parameters: { name: string; value: string }[];
      }[];
      userErrors: { message: string }[];
    };
  }>(gql, STAGE, {
    input: [
      {
        filename,
        mimeType: icon.mimeType,
        resource,
        httpMethod: "POST",
        fileSize: String(bytes.length),
      },
    ],
  });
  const target = stagedUploadsCreate.stagedTargets[0];
  if (stagedUploadsCreate.userErrors.length || !target) {
    throw new ShopifyApiError(
      `Icon upload refused: ${stagedUploadsCreate.userErrors.map((e) => e.message).join("; ")}`,
    );
  }

  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append(
    "file",
    new Blob([bytes as BlobPart], { type: icon.mimeType }),
    filename,
  );
  const res = await upload(target.url, { method: "POST", body: form });
  if (!res.ok) {
    throw new ShopifyApiError(`Icon upload failed (${res.status})`);
  }

  const { fileCreate } = await gqlData<{
    fileCreate: {
      files: { id: string; fileStatus: string }[] | null;
      userErrors: { message: string }[];
    };
  }>(gql, CREATE, {
    files: [
      {
        originalSource: target.resourceUrl,
        contentType: resource,
        alt: "My Selection icon",
      },
    ],
  });
  const file = fileCreate.files?.[0];
  if (fileCreate.userErrors.length || !file) {
    throw new ShopifyApiError(
      `Icon file not created: ${fileCreate.userErrors.map((e) => e.message).join("; ")}`,
    );
  }

  for (let i = 0; i < POLLS; i++) {
    const { node } = await gqlData<{
      node: {
        fileStatus?: string;
        url?: string | null;
        image?: { url: string } | null;
      } | null;
    }>(gql, FILE, { id: file.id });
    const url = node?.image?.url ?? node?.url ?? null;
    if (node?.fileStatus === "FAILED") {
      throw new ShopifyApiError("Shopify couldn't process the icon.");
    }
    if (node?.fileStatus === "READY" && url?.startsWith("https://")) return url;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new ShopifyApiError(
    "The icon is still processing. Try again in a minute.",
  );
}
