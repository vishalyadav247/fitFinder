// Empty state inside a section, after the Polaris "Empty state" composition (centred visual,
// heading, short explanation, actions). We have no illustrations, so the visual is a large icon
// tile: Sky for "nothing here yet", green for "all done", a spinner while data is loading.
import type { ReactNode } from "react";

type IconType = NonNullable<JSX.IntrinsicElements["s-icon"]["type"]>;

export function EmptyState({
  icon,
  tone = "info",
  heading,
  children,
  actions,
}: {
  icon?: IconType;
  /** info: nothing here yet · success: all done · loading: spinner instead of the icon. */
  tone?: "info" | "success" | "loading";
  heading: string;
  children?: ReactNode;
  /** Buttons; the primary one last. */
  actions?: ReactNode;
}) {
  return (
    <s-box padding="base" paddingBlock="large-300">
      <s-grid gap="base" justifyItems="center">
        <span
          className={`ff-empty__tile ff-empty__tile--${tone}`}
          aria-hidden="true"
        >
          {tone === "loading" ? (
            <s-spinner size="base" accessibilityLabel="Loading" />
          ) : (
            icon && (
              <s-icon
                type={icon}
                tone={tone === "success" ? "success" : "info"}
              />
            )
          )}
        </span>
        <s-grid justifyItems="center" maxInlineSize="440px" gap="small-200">
          <s-heading>{heading}</s-heading>
          {children && (
            <div className="ff-empty__text">
              <s-paragraph color="subdued">{children}</s-paragraph>
            </div>
          )}
        </s-grid>
        {/* A plain centred row: s-button-group only shows slotted buttons, so plain ones vanished. */}
        {actions && (
          <s-stack direction="inline" gap="small-200" justifyContent="center">
            {actions}
          </s-stack>
        )}
      </s-grid>
    </s-box>
  );
}
