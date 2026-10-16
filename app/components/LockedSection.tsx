// A part of a screen the shop's plan doesn't include (Custom CSS, Universal products, import
// backups): its content shows blurred and can't be used, with a gold plan badge and Upgrade on
// top. Styles: theme.css (.sp-locked).
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { Icon } from "./Icon";

export function LockedSection({
  plan,
  feature,
  text,
  children,
}: {
  /** The plan that adds the feature; "" when no visible plan has it yet. */
  plan: string;
  /** "Custom CSS", "Universal products" … */
  feature: string;
  /** One short line on what upgrading gives. */
  text: string;
  /** Shown blurred behind the layer (inert: no focus, no clicks). */
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="sp-locked">
      <div className="sp-locked__content" inert aria-hidden="true">
        {children}
      </div>
      <div className="sp-locked__layer">
        <div className="sp-locked__card">
          <span className="sp-locked__badge">
            <Icon name="lock" size={14} />
            {plan ? `${plan} plan` : "Higher plan"}
          </span>
          <s-text type="strong">
            {plan
              ? `${feature} is on the ${plan} plan`
              : `${feature} is on a higher plan`}
          </s-text>
          <p className="sp-locked__text">{text}</p>
          <s-button variant="primary" onClick={() => navigate("/app/plans")}>
            {plan ? `Upgrade to ${plan}` : "Compare plans"}
          </s-button>
        </div>
      </div>
    </div>
  );
}
