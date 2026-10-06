// Shopify Files upload of the My Selection icon (icon-upload.server.ts) with a fake Admin API.
import { describe, expect, it } from "vitest";
import { uploadIcon } from "./icon-upload.server";

const PNG = {
  ok: true as const,
  kind: "png" as const,
  mimeType: "image/png",
  extension: "png",
};

function api(
  over: { stage?: unknown; create?: unknown; nodes?: unknown[] } = {},
) {
  const nodes = [
    ...(over.nodes ?? [
      { fileStatus: "READY", image: { url: "https://cdn.shopify.com/i.png" } },
    ]),
  ];
  const calls: string[] = [];
  const gql = async (query: string) => {
    calls.push(query);
    let data: unknown;
    if (query.includes("stagedUploadsCreate")) {
      data = over.stage ?? {
        stagedUploadsCreate: {
          stagedTargets: [
            {
              url: "https://upload.test",
              resourceUrl: "https://res.test/1",
              parameters: [{ name: "key", value: "k" }],
            },
          ],
          userErrors: [],
        },
      };
    } else if (query.includes("fileCreate")) {
      data = over.create ?? {
        fileCreate: {
          files: [{ id: "gid://shopify/MediaImage/1", fileStatus: "UPLOADED" }],
          userErrors: [],
        },
      };
    } else {
      data = { node: nodes.length > 1 ? nodes.shift() : nodes[0] };
    }
    return { json: async () => ({ data }) };
  };
  return { gql, calls };
}
const okUpload = (async () =>
  new Response(null, { status: 204 })) as typeof fetch;
const opts = { pollMs: 0, upload: okUpload };
const bytes = new Uint8Array([1, 2, 3]);

describe("uploadIcon", () => {
  it("stages, uploads, creates the file and waits until it is ready", async () => {
    const { gql } = api({
      nodes: [
        { fileStatus: "PROCESSING" },
        {
          fileStatus: "READY",
          image: { url: "https://cdn.shopify.com/i.png" },
        },
      ],
    });
    expect(await uploadIcon(gql, bytes, PNG, opts)).toBe(
      "https://cdn.shopify.com/i.png",
    );
  });

  it("stops on staged upload errors, a failed upload and fileCreate errors", async () => {
    await expect(
      uploadIcon(
        api({
          stage: {
            stagedUploadsCreate: {
              stagedTargets: [],
              userErrors: [{ message: "no" }],
            },
          },
        }).gql,
        bytes,
        PNG,
        opts,
      ),
    ).rejects.toThrow("refused");
    await expect(
      uploadIcon(api().gql, bytes, PNG, {
        pollMs: 0,
        upload: (async () =>
          new Response(null, { status: 403 })) as typeof fetch,
      }),
    ).rejects.toThrow("403");
    await expect(
      uploadIcon(
        api({
          create: {
            fileCreate: { files: null, userErrors: [{ message: "bad" }] },
          },
        }).gql,
        bytes,
        PNG,
        opts,
      ),
    ).rejects.toThrow("bad");
  });

  it("gives up on FAILED files, non-https URLs and files that never get ready", async () => {
    await expect(
      uploadIcon(
        api({ nodes: [{ fileStatus: "FAILED" }] }).gql,
        bytes,
        PNG,
        opts,
      ),
    ).rejects.toThrow("process");
    await expect(
      uploadIcon(
        api({ nodes: [{ fileStatus: "READY", url: "http://x" }] }).gql,
        bytes,
        PNG,
        opts,
      ),
    ).rejects.toThrow("still processing");
    const { gql, calls } = api({ nodes: [{ fileStatus: "PROCESSING" }] });
    await expect(uploadIcon(gql, bytes, PNG, opts)).rejects.toThrow(
      "still processing",
    );
    expect(calls.filter((q) => q.includes("query IconFile"))).toHaveLength(15);
  });
});
