// Section title with a Sky-tinted icon chip (theme.css .sp-sec-head). The title keeps the bolder
// Polaris heading style (.sp-sec-title, design README rule 1).
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
    <div className={gap ? "sp-sec-head sp-sec-gap" : "sp-sec-head"}>
      <span className="sp-sec-ico" aria-hidden="true">
        <s-icon type={icon} tone="info" size="small" />
      </span>
      <h2 className="sp-sec-title">{children}</h2>
    </div>
  );
}
