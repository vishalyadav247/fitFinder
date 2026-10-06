// Section title with a Sky-tinted icon chip (theme.css .ff-sec-head). The title keeps the bolder
// Polaris heading style (.ff-sec-title, design README rule 1).
import type { ReactNode } from "react";

type IconType = NonNullable<JSX.IntrinsicElements["s-icon"]["type"]>;

export function SectionTitle({
  icon,
  gap,
  children,
}: {
  icon: IconType;
  /** Space below the title (when the content follows directly, not in a stack). */
  gap?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={gap ? "ff-sec-head ff-sec-gap" : "ff-sec-head"}>
      <span className="ff-sec-ico" aria-hidden="true">
        <s-icon type={icon} tone="info" size="small" />
      </span>
      <h2 className="ff-sec-title">{children}</h2>
    </div>
  );
}
