// Dropdown that opens its list below the field (s-select is the browser's native <select>, which
// macOS draws over the field). Polaris parts only: an s-clickable styled as a field opens an
// s-popover of options. Same props as s-select, but onChange gets the value. Styles: theme.css
// (.sp-select).
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** One choice; children are its text. Read by Select, never rendered on its own. */
export function Option(props: { value: string; children: ReactNode }) {
  void props;
  return null;
}

const textOf = (node: ReactNode): string =>
  Children.toArray(node)
    .map((c) => (typeof c === "string" || typeof c === "number" ? c : ""))
    .join("");

export function Select({
  label,
  labelAccessibilityVisibility,
  details,
  value,
  disabled,
  onChange,
  children,
}: {
  label: string;
  labelAccessibilityVisibility?: "visible" | "exclusive";
  details?: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const options = Children.toArray(children)
    .filter(isValidElement<{ value: string; children: ReactNode }>)
    .map((c) => ({ value: c.props.value, label: textOf(c.props.children) }));
  const current = options.find((o) => o.value === value) ?? options[0];

  const id = useId().replace(/:/g, "");
  const popId = `sp-sel-${id}`;
  const fieldRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  const optionEls = () =>
    Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("s-clickable") ?? [],
    );

  const pick = (v: string) => {
    if (v !== value) onChange(v);
  };

  // Up / Down / Home / End move between options (the popover handles Escape). Listened to on the
  // list itself: the options are s-clickable buttons in a plain group.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.addEventListener("keydown", onKey);
    return () => list.removeEventListener("keydown", onKey);
  });
  const onKey = (e: globalThis.KeyboardEvent) => {
    const els = optionEls();
    const at = els.indexOf(document.activeElement as HTMLElement);
    const to =
      e.key === "ArrowDown"
        ? Math.min(at + 1, els.length - 1)
        : e.key === "ArrowUp"
          ? Math.max(at - 1, 0)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? els.length - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    els[to]?.focus();
  };

  const hidden = labelAccessibilityVisibility === "exclusive";

  return (
    <div className={disabled ? "sp-select is-disabled" : "sp-select"}>
      {!hidden && (
        <span className="sp-select-label" aria-hidden="true">
          {label}
        </span>
      )}
      <div ref={fieldRef}>
        <s-clickable
          commandFor={popId}
          disabled={disabled}
          accessibilityLabel={`${label}: ${current?.label ?? ""}`}
          border="base"
          borderRadius="base"
          background="base"
          paddingBlock="small-300"
          paddingInline="small-100 small-300"
          onClick={() => setWidth(fieldRef.current?.offsetWidth ?? 0)}
        >
          <span className="sp-select-field">
            <span className="sp-select-value">{current?.label}</span>
            <s-icon type="select" size="small" />
          </span>
        </s-clickable>
      </div>
      {details && (
        <span className="sp-select-details">
          <s-text color="subdued">{details}</s-text>
        </span>
      )}
      <s-popover
        id={popId}
        inlineSize={width ? `${width}px` : "auto"}
        minInlineSize="120px"
        maxBlockSize="320px"
        onAfterShow={() => {
          const els = optionEls();
          const i = options.findIndex((o) => o.value === current?.value);
          els[Math.max(0, i)]?.focus();
        }}
      >
        <div
          ref={listRef}
          className="sp-select-list"
          role="group"
          aria-label={label}
        >
          {options.map((o) => {
            const on = o.value === current?.value;
            return (
              <s-clickable
                key={o.value}
                commandFor={popId}
                command="--hide"
                padding="small-200 small-100"
                borderRadius="base"
                background={on ? "subdued" : "transparent"}
                accessibilityLabel={on ? `${o.label} (selected)` : o.label}
                onClick={() => pick(o.value)}
              >
                <span className="sp-select-option">
                  <span>{o.label}</span>
                  {on && <s-icon type="check" size="small" />}
                </span>
              </s-clickable>
            );
          })}
        </div>
      </s-popover>
    </div>
  );
}
