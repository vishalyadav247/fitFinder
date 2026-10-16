// One live preview of the Storefront page: an iframe with the real theme script and stylesheet
// (preview-doc.ts; the files come from the loader, see preview-assets.server.ts). Rebuilt shortly
// after a setting changes; the scripts' app proxy calls for dropdown options and results go to
// /api/storefront-preview.
import { useEffect, useRef, useState } from "react";
import type { StorefrontConfig } from "../../services/storefront/config";
import {
  previewCss,
  previewDoc,
  previewScript,
  type PreviewAssets,
  type PreviewKind,
  type PreviewSampleData,
} from "./preview-doc";

const PATHS = new Set(["options", "results"]);
const REBUILD_MS = 150;
export const SELECTION_HEIGHT = 320;

type Picks = Record<string, string>;

export function StorefrontPreview({
  kind,
  config,
  sample,
  assets,
  title,
  picks,
  onPicks,
}: {
  kind: PreviewKind;
  /** The theme's scripts and stylesheets (loader data, preview-assets.server.ts). */
  assets: PreviewAssets;
  config: StorefrontConfig;
  sample: PreviewSampleData;
  title: string;
  /** Search widget: picks kept across rebuilds. */
  picks?: { current: Picks };
  onPicks?: (picks: Picks) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const build = () =>
    previewDoc({
      kind,
      config,
      css: previewCss(kind, assets),
      script: previewScript(kind, assets),
      sample,
      picks: picks?.current,
    });
  const [doc, setDoc] = useState(build);
  const [height, setHeight] = useState(
    kind === "selection" ? SELECTION_HEIGHT : 60,
  );
  const key = JSON.stringify(config);

  useEffect(() => {
    const t = setTimeout(() => setDoc(build()), REBUILD_MS);
    return () => clearTimeout(t);
    // build reads the latest props; rebuild only when the config, kind or sample changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, kind, sample]);

  // The document loads from a blob: URL made in the browser, not from a srcdoc attribute: the
  // attribute's HTML got rewritten in the admin (every " became '), which broke the preview's
  // scripts whenever the frame loaded from it (after a page reload, or when it reloaded itself).
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([doc], { type: "text/html" }));
    if (frame.current) frame.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [doc]);

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      const d = e.data;
      if (!win || e.source !== win || !d || typeof d !== "object") return;
      if (d.sp === "height" && kind !== "selection") {
        setHeight(Math.min(Math.max(Number(d.h) || 0, 40), 3000));
      } else if (d.sp === "picks" && d.picks && typeof d.picks === "object") {
        onPicks?.(d.picks as Picks);
      } else if (d.sp === "fetch") {
        const answer = (ok: boolean, body?: unknown) =>
          win.postMessage({ sp: "reply", id: d.id, ok, body }, "*");
        if (!PATHS.has(d.path)) return answer(false);
        const params = new URLSearchParams(String(d.q ?? ""));
        params.set("path", d.path);
        try {
          const res = await fetch(`/api/storefront-preview?${params}`);
          answer(res.ok, res.ok ? await res.json() : undefined);
        } catch {
          answer(false);
        }
      }
    };
    window.addEventListener("message", onMessage);
    // The frame may have loaded (and sent its height or a request) before this listener existed.
    frame.current?.contentWindow?.postMessage({ sp: "hello" }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [kind, onPicks]);

  return (
    <iframe
      ref={frame}
      title={title}
      sandbox="allow-scripts"
      className="sp-pv-frame"
      style={{ height }}
    />
  );
}
