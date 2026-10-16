// Number and date formats shared by the backoffice pages (UTC dates, so server and browser agree).

export const n = (v: number) => v.toLocaleString("en-US");

export const plural = (v: number, one: string, many: string) =>
  `${n(v)} ${v === 1 ? one : many}`;

/** "Oct 3" (UTC). */
export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** "3 h ago", "2 d ago" (from the loader's clock, so server and browser agree). */
export function ago(iso: string, now: string) {
  const s = Math.max(0, (Date.parse(now) - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}
