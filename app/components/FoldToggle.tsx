// Show / hide button for a collapsible card (Dashboard setup guide, Storefront theme
// integration): a small bordered square with a chevron. Styles: theme.css .sp-fold-toggle.
import { Icon } from "./Icon";

export function FoldToggle({
  open,
  label,
  onToggle,
}: {
  open: boolean;
  /** What it shows or hides, lower case: "setup guide". */
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="sp-fold-toggle"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${open ? "Hide" : "Show"} ${label}`}
    >
      <Icon name={open ? "up" : "down"} size={18} stroke={2.2} />
    </button>
  );
}
