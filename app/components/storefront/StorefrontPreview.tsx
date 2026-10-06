// One live preview of the Storefront page: an iframe with the real theme script and stylesheet
// (preview-doc.ts). Rebuilt shortly after a setting changes; the scripts' app proxy calls for
// dropdown options and results go to /api/storefront-preview.
import { useEffect, useRef, useState } from "react";
import embedCss from "../../../extensions/fitfinder-theme/assets/ff-embed.css?raw";
import searchCss from "../../../extensions/fitfinder-theme/assets/ff-search.css?raw";
import productCss from "../../../extensions/fitfinder-theme/assets/ff-product.css?raw";
import searchJs from "../../../extensions/fitfinder-theme/assets/ff-search.js?raw";
import productJs from "../../../extensions/fitfinder-theme/assets/ff-product.js?raw";
import embedJs from "../../../extensions/fitfinder-theme/assets/ff-embed.js?raw";
import type { StorefrontConfig } from "../../services/storefront/config";
import {
  previewDoc,
  type PreviewKind,
  type PreviewSampleData,
} from "./preview-doc";

const SCRIPTS: Record<PreviewKind, string> = {
  search: searchJs,
  badge: productJs,
  table: productJs,
  selection: embedJs,
};

// The stylesheets a page with that feature loads on the storefront (embed + block).
const STYLES: Record<PreviewKind, string> = {
  search: embedCss + searchCss,
  badge: embedCss + productCss,
  table: embedCss + productCss,
  selection: embedCss,
};

const PATHS = new Set(["options", "results"]);
const REBUILD_MS = 150;
export const SELECTION_HEIGHT = 320;

type Picks = Record<string, string>;

export function StorefrontPreview({
  kind,
  config,
  sample,
  title,
  picks,
  onPicks,
}: {
  kind: PreviewKind;
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
      css: STYLES[kind],
      script: SCRIPTS[kind],
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

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      const d = e.data;
      if (!win || e.source !== win || !d || typeof d !== "object") return;
      if (d.ff === "height" && kind !== "selection") {
        setHeight(Math.min(Math.max(Number(d.h) || 0, 40), 3000));
      } else if (d.ff === "picks" && d.picks && typeof d.picks === "object") {
        onPicks?.(d.picks as Picks);
      } else if (d.ff === "fetch") {
        const answer = (ok: boolean, body?: unknown) =>
          win.postMessage({ ff: "reply", id: d.id, ok, body }, "*");
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
    return () => window.removeEventListener("message", onMessage);
  }, [kind, onPicks]);

  return (
    <iframe
      ref={frame}
      title={title}
      sandbox="allow-scripts"
      srcDoc={doc}
      className="ff-pv-frame"
      style={{ height }}
    />
  );
}
