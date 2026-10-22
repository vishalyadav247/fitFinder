import { describe, expect, it } from "vitest";
import { skipTabOnlyChanges, tabFromParam } from "./url-tab";

const TABS = [
  { key: "u", slug: "unlinked-rows", aliases: ["u"] },
  { key: "p", slug: "products-without-data", aliases: ["p"] },
] as const;

describe("tabs in the URL", () => {
  it("opens a tab by its name or an older short name", () => {
    expect(tabFromParam(TABS, "products-without-data")).toBe("p");
    expect(tabFromParam(TABS, "p")).toBe("p");
    expect(tabFromParam(TABS, "nope")).toBeNull();
    expect(tabFromParam(TABS, null)).toBeNull();
  });

  it("doesn't reload the page's data when only the tab changes", () => {
    const run = (from: string, to: string, formMethod?: string) =>
      skipTabOnlyChanges({
        currentUrl: new URL(`https://x.test/app/a${from}`),
        nextUrl: new URL(`https://x.test/app/a${to}`),
        formMethod,
        defaultShouldRevalidate: true,
      } as never);
    expect(run("?tab=a&page=2", "?page=2&tab=b")).toBe(false);
    expect(run("?tab=a", "?tab=a")).toBe(true); // explicit reload
    expect(run("?tab=a&page=2", "?tab=b&page=3")).toBe(true);
    expect(run("?tab=a", "?tab=b", "POST")).toBe(true);
  });
});
