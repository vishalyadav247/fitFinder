// Picks product tags (Results page tab: filter groups and tag badges). One search field, the
// picked tags as removable chips under it, then the store's tags (active products, most used
// first, from /api/storefront-tags; searched as the merchant types) as checkboxes, and
// Add "{typed}" for a tag that isn't listed. Give it a new `key` each time its modal opens.
import { useEffect, useRef, useState } from "react";

type StoreTag = { tag: string; products: number };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function TagPicker({
  picked,
  onChange,
  max,
  error,
  note,
}: {
  picked: string[];
  onChange: (tags: string[]) => void;
  /** Most tags that can be picked. */
  max: number;
  /** Shown in red while nothing is picked (e.g. "Pick at least one tag"). */
  error?: string;
  /** Line under the list. */
  note: string;
}) {
  const [query, setQuery] = useState("");
  const [list, setList] = useState<StoreTag[] | null>(null);
  const [failed, setFailed] = useState(false);
  const run = useRef(0);

  // First load at once, then 250 ms after the last keystroke.
  useEffect(() => {
    const mine = ++run.current;
    const t = setTimeout(
      () => {
        setFailed(false);
        fetch(`/api/storefront-tags?q=${encodeURIComponent(query)}`)
          .then((res) => {
            // A failed read (e.g. a timeout) says so, instead of "no tags yet".
            if (!res.ok) throw new Error(`tags ${res.status}`);
            return res.json() as Promise<{ tags?: StoreTag[] }>;
          })
          .then((body) => {
            if (mine === run.current) setList(body.tags ?? []);
          })
          .catch(() => {
            if (mine === run.current) setFailed(true);
          });
      },
      list === null ? 0 : 250,
    );
    return () => clearTimeout(t);
    // Searches again only when the text changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const has = (tag: string) => picked.some((t) => same(t, tag));
  /** Idempotent: a repeated event (some fields fire twice) changes nothing. */
  const set = (tag: string, on: boolean) => {
    if (on === has(tag)) return;
    if (on) {
      if (picked.length < max) onChange([...picked, tag]);
    } else onChange(picked.filter((t) => !same(t, tag)));
  };
  const typed = query.trim().slice(0, 255);
  const value = (e: Event) =>
    String((e.currentTarget as HTMLInputElement).value ?? "");

  return (
    <s-stack gap="small-200">
      <s-search-field
        label="Tags"
        placeholder="Search your product tags or type one"
        value={query}
        onInput={(e) => setQuery(value(e))}
      />
      {error && picked.length === 0 && <s-text tone="critical">{error}</s-text>}
      {picked.length > 0 && (
        <div className="sp-rp-chips">
          {picked.map((tag) => (
            <s-clickable-chip
              key={tag}
              removable
              accessibilityLabel={`Remove ${tag}`}
              onRemove={() => set(tag, false)}
            >
              {tag}
            </s-clickable-chip>
          ))}
        </div>
      )}
      <div className="sp-rp-taglist">
        {typed &&
          !has(typed) &&
          !list?.some((t) => same(t.tag, typed)) &&
          picked.length < max && (
            <s-button
              icon="plus"
              variant="tertiary"
              onClick={() => {
                set(typed, true);
                setQuery("");
              }}
            >
              {`Add "${typed}"`}
            </s-button>
          )}
        {failed ? (
          <s-text color="subdued">
            Your tags couldn&apos;t be loaded. You can still type a tag.
          </s-text>
        ) : list && list.length > 0 ? (
          list.map((t) => (
            <s-checkbox
              key={t.tag}
              label={`${t.tag} (${t.products.toLocaleString("en-US")})`}
              checked={has(t.tag)}
              disabled={!has(t.tag) && picked.length >= max}
              onChange={(e) =>
                set(
                  t.tag,
                  !!(e.currentTarget as unknown as HTMLInputElement).checked,
                )
              }
            />
          ))
        ) : (
          <s-text color="subdued">
            {query.trim()
              ? "No product has a tag like that."
              : "Your products have no tags yet. You can still type one."}
          </s-text>
        )}
      </div>
      <s-text color="subdued">{note}</s-text>
    </s-stack>
  );
}
