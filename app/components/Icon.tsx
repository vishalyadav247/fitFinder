// Line icons for the custom areas (dashboard banner, setup guide); paths from the prototype's
// .claude/design/scripts/core/icons.js. Polaris components use Polaris icons.
const PATHS = {
  left: '<path d="M12 5l-5 5 5 5"/>',
  right: '<path d="M8 5l5 5-5 5"/>',
  up: '<path d="M6 12l4-4 4 4"/>',
  down: '<path d="M6 8l4 4 4-4"/>',
  fields:
    '<rect x="3" y="4" width="14" height="4" rx="1.5"/><rect x="3" y="12" width="14" height="4" rx="1.5"/>',
  upload:
    '<path d="M10 13V4M6.5 7.5 10 4l3.5 3.5"/><path d="M3.5 13v3.5h13V13"/>',
  link: '<path d="M8.5 11.5l3-3M7.5 9 5.5 11a2.5 2.5 0 003.5 3.5l2-2M12.5 11l2-2A2.5 2.5 0 0011 5.5L9 7.5"/>',
  store: '<path d="M3 8l1.5-4h11L17 8M4 8v9h12V8M3 8h14"/>',
  plans:
    '<rect x="3" y="5" width="14" height="10" rx="2"/><path d="M3 8.5h14"/>',
  car: '<path d="M3 13v-2.5L5 6h10l2 4.5V13z"/><circle cx="6.5" cy="13.5" r="1.5"/><circle cx="13.5" cy="13.5" r="1.5"/>',
  phone:
    '<rect x="6" y="2.5" width="8" height="15" rx="2"/><path d="M9 15h2"/>',
  beauty:
    '<rect x="7" y="8" width="6" height="9.5" rx="1.5"/><path d="M8 8V5.5l4-3V8"/>',
  spark:
    '<path d="M10 2v4M10 14v4M2 10h4M14 10h4M4.5 4.5l2.5 2.5M13 13l2.5 2.5M4.5 15.5 7 13M13 7l2.5-2.5"/>',
  rows: '<path d="M4 5h12M4 10h12M4 15h12"/>',
  check: '<path d="M5 10.5l3 3L15 7"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 16,
  stroke = 2,
}: {
  name: IconName;
  size?: number;
  stroke?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // Static paths from this file only.
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
