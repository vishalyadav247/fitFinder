// Page title inside the page, with the page's actions on its right (agreed 2026-10-06). s-page
// gets no heading and no slotted buttons, so the admin title bar shows only the app name and its
// ⋯ menu (s-page sends its heading and primary-action/secondary-actions slots to the title bar).
import type { ReactNode } from "react";

export function PageHeader({
  title,
  children,
}: {
  title: string;
  /** Action buttons, secondary first and the primary one last (rightmost). */
  children?: ReactNode;
}) {
  return (
    <div className="ff-page-head">
      <h1 className="ff-page-title">{title}</h1>
      {children && <div className="ff-page-actions">{children}</div>}
    </div>
  );
}
