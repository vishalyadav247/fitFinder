// Page tabs kept in the URL (?tab={slug}), so a link, a reload or the back button opens the same
// tab (agreed 2026-10-22). Every tab has a readable slug; older short names still open it.
import { useEffect } from "react";
import { useSearchParams, type ShouldRevalidateFunction } from "react-router";

export interface UrlTab<K extends string> {
  key: K;
  /** The tab's name in the URL, e.g. "results-page". */
  slug: string;
  /** Older names that still open it, e.g. "results". */
  aliases?: readonly string[];
}

/** The tab a ?tab= value opens, or null when it names none. */
export function tabFromParam<K extends string>(
  tabs: readonly UrlTab<K>[],
  value: string | null,
): K | null {
  if (value === null) return null;
  return (
    tabs.find((t) => t.slug === value || t.aliases?.includes(value))?.key ??
    null
  );
}

/**
 * The open tab and a function to switch it. Without a (known) ?tab=, `fallback` opens (default:
 * the first tab), and the URL is updated to its slug in place.
 */
export function useUrlTab<K extends string>(
  tabs: readonly UrlTab<K>[],
  fallback?: K,
): [K, (key: K) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const key = tabFromParam(tabs, raw) ?? fallback ?? tabs[0].key;
  const slugOf = (k: K) => tabs.find((t) => t.key === k)!.slug;
  const show = (k: K) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", slugOf(k));
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  const slug = slugOf(key);
  useEffect(() => {
    if (raw !== slug) show(key);
    // show only writes the URL; run when the URL's tab differs from the open one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, slug]);
  return [key, show];
}

/**
 * For a page's shouldRevalidate: switching tabs only changes ?tab=, and the page already has its
 * data, so don't load it again. Anything else (forms, other params, explicit reloads) loads.
 */
export const skipTabOnlyChanges: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}) => {
  // Same URL = an explicit reload (revalidator): always load.
  if (
    formMethod ||
    currentUrl.pathname !== nextUrl.pathname ||
    currentUrl.search === nextUrl.search
  ) {
    return defaultShouldRevalidate;
  }
  const strip = (url: URL) => {
    const p = new URLSearchParams(url.search);
    p.delete("tab");
    p.sort();
    return p.toString();
  };
  return strip(currentUrl) === strip(nextUrl) ? false : defaultShouldRevalidate;
};
