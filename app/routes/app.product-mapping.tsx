// Product mapping: link filter rows to store products, find products without filter data, keep
// universal products. Spec: .claude/specs/product-mapping.md · Prototype:
// .claude/design/scripts/screens/product-mapping.js
// Lists are paged in the URL (u = unlinked, p = products, x = universal). Check links again runs
// as a job; the page polls the loader until it has finished.
import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  ShouldRevalidateFunction,
} from "react-router";
import {
  data,
  useFetcher,
  useLoaderData,
  useNavigate,
  useNavigation,
  useRevalidator,
  useSearchParams,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { ensureShop } from "../models/shop.server";
import { getSearchConfig } from "../models/search-config.server";
import { listRowFields, rowCounts } from "../models/fitment-row.server";
import {
  LinkRuleError,
  addUniversal,
  linkManually,
  mappingIntentSchema,
  productTitle,
  productsWithoutData,
  removeUniversal,
  unlinkedGroups,
  universalProducts,
  type UnlinkedGroup,
} from "../models/product-link.server";
import {
  fetchProduct,
  fetchResources,
  upsertCollections,
  upsertProducts,
  type AdminGraphql,
} from "../services/linking/catalog.server";
import {
  linkCheckState,
  type LinkCheckView,
} from "../services/linking/link-runs.server";
import { requestLinkCheck } from "../services/jobs.server";
import {
  MAX_PICK,
  kindLabel,
  productLinkAttachment,
} from "../services/linking/attachment";
import { cellDisplay, type RowField } from "../services/fitment/rows";
import { TableFooter } from "../components/TableFooter";
import { EmptyState } from "../components/EmptyState";
import { Icon, type IconName } from "../components/Icon";
import {
  DEFAULT_TABLE_PAGE_SIZE,
  TABLE_PAGE_SIZES,
  tablePageSize,
} from "../components/table-paging";
import styles from "../styles/product-mapping.css?url";
import { SectionTitle } from "../components/SectionTitle";
import { PageHeader } from "../components/PageHeader";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

const POLL_MS = 2000;
const MAX_IDLE_POLLS = 15;

const isActive = (s: { status: string }) =>
  s.status === "queued" || s.status === "running";

const pageParam = (url: URL, key: string) => {
  const n = Number(url.searchParams.get(key) ?? 1);
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : 1;
};

// Rows per page of each table (?un= ?pn= ?xn=): the admin's table standard (table-paging.ts).
const sizeParam = (url: URL, key: string) =>
  tablePageSize(url.searchParams.get(key));

type TableKey = "u" | "p" | "x";

// One tab per list (?tab=); Unlinked rows first.
// Line icons (they follow the text colour: white on the active tab), like the section titles.
const TABS = [
  ["u", "Unlinked rows", "link"],
  ["p", "Products without filter data", "product"],
  ["x", "Universal products", "globe"],
] as const satisfies readonly (readonly [TableKey, string, IconName])[];
const tabParam = (value: string | null): TableKey =>
  TABS.find(([k]) => k === value)?.[0] ?? "u";

/** Switching tabs only changes ?tab=: the lists are already loaded, so don't load them again. */
export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}) => {
  // Same URL = an explicit reload (revalidator, after a link check): always load.
  if (
    formMethod ||
    currentUrl.pathname !== nextUrl.pathname ||
    currentUrl.search === nextUrl.search
  ) {
    return defaultShouldRevalidate;
  }
  const strip = (url: URL) => {
    const p = new URLSearchParams(url.search);
    p.delete("tab");
    p.sort();
    return p.toString();
  };
  return strip(currentUrl) === strip(nextUrl) ? false : defaultShouldRevalidate;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, redirect } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const config = await getSearchConfig(shop.id);
  // The layout redirects too, but child loaders run in parallel with it.
  if (!config) throw redirect("/app/onboarding");

  let linkCheck = await linkCheckState(shop.id);
  // First visit: load the store's products so the lists below mean something.
  if (linkCheck.status === "idle") {
    await requestLinkCheck(shop.id, { fullSync: true }).catch((error) =>
      console.error("product-mapping: couldn't queue the first link check", {
        shop: session.shop,
        error,
      }),
    );
    linkCheck = await linkCheckState(shop.id);
  }

  const url = new URL(request.url);
  const read = {
    u: (page: number) => unlinkedGroups(shop.id, page, sizeParam(url, "un")),
    p: (page: number) =>
      productsWithoutData(shop.id, page, sizeParam(url, "pn")),
    x: (page: number) => universalProducts(shop.id, page, sizeParam(url, "xn")),
  };
  const [fields, counts, firstUnlinked, firstWithout, firstUniversal] =
    await Promise.all([
      listRowFields(shop.id),
      rowCounts(shop.id),
      read.u(pageParam(url, "u")),
      read.p(pageParam(url, "p")),
      read.x(pageParam(url, "x")),
    ]);
  // Past the last page (e.g. the last item of page 3 was just linked or removed): show the last
  // page that has items instead of an empty list without paging.
  const lastPage = async <
    T extends { page: number; pageSize: number; items: unknown[] },
  >(
    list: T,
    total: number,
    again: (page: number) => Promise<T>,
  ) =>
    list.page > 1 && !list.items.length && total > 0
      ? again(Math.ceil(total / list.pageSize))
      : list;
  const [unlinked, withoutData, universal] = await Promise.all([
    lastPage(firstUnlinked, counts.unlinkedSkus, read.u),
    lastPage(firstWithout, firstWithout.total, read.p),
    lastPage(firstUniversal, firstUniversal.total, read.x),
  ]);
  return {
    noun: config.noun,
    things: config.thingsWord,
    fields,
    unlinkedCount: counts.unlinkedSkus,
    unlinked,
    withoutData,
    universal,
    linkCheck,
  };
};

export type MappingResult =
  { ok: true; toast?: string; attempt?: number } | { ok: false; error: string };

const NOT_SAVED = "That change couldn't be saved. Try again.";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await ensureShop(session.shop);
  const parsed = mappingIntentSchema.safeParse(
    Object.fromEntries(await request.formData()),
  );
  if (!parsed.success) {
    return data<MappingResult>(
      { ok: false, error: "That change couldn't be saved." },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const gql = admin.graphql as unknown as AdminGraphql;

  try {
    switch (input.intent) {
      case "check": {
        const started = await requestLinkCheck(shop.id, { fullSync: true });
        const state = await linkCheckState(shop.id);
        // A running check can't take the request: it runs again when it ends (attempt + 1).
        const attempt =
          !started && state.status === "running"
            ? state.attempt + 1
            : state.attempt;
        return data<MappingResult>({ ok: true, attempt });
      }
      case "link": {
        // Read the chosen resource from Shopify; never trust ids or titles from the browser.
        if (input.resourceId.startsWith("gid://shopify/Collection/")) {
          const { collections } = await fetchResources(gql, [input.resourceId]);
          if (!collections.length) {
            throw new LinkRuleError("That collection no longer exists.");
          }
          await upsertCollections(shop.id, collections);
          await linkManually(shop.id, input.attachment, {
            type: "collection",
            collectionId: collections[0].collectionId,
          });
          return data<MappingResult>({
            ok: true,
            toast: `${input.attachment} linked to a collection`,
          });
        }
        const product = await fetchProduct(gql, input.resourceId);
        if (!product) throw new LinkRuleError("That product no longer exists.");
        await upsertProducts(shop.id, [product], { replaceVariants: true });
        const variantId =
          input.variantId &&
          product.variants.some((v) => v.variantId === input.variantId)
            ? input.variantId
            : null;
        await linkManually(shop.id, input.attachment, {
          type: "product",
          productId: product.productId,
          variantId,
        });
        return data<MappingResult>({
          ok: true,
          toast: `${input.attachment} linked to a product`,
        });
      }
      case "universal-add": {
        const { products } = await fetchResources(gql, input.ids);
        await upsertProducts(shop.id, products, { replaceVariants: false });
        const added = await addUniversal(
          shop.id,
          products.map((p) => p.productId),
        );
        if (added === 0) {
          throw new LinkRuleError(
            products.length === 0
              ? "Those products no longer exist."
              : products.length === 1
                ? `${products[0].title} is already universal.`
                : "Those products are already universal.",
          );
        }
        const toast =
          products.length === 1
            ? `${products[0].title} is now universal`
            : `${added} product${added === 1 ? "" : "s"} added to universal products`;
        return data<MappingResult>({ ok: true, toast });
      }
      case "universal-mark": {
        const title = await productTitle(shop.id, input.productId);
        if ((await addUniversal(shop.id, [input.productId])) === 0) {
          throw new LinkRuleError(`${title} is already universal.`);
        }
        return data<MappingResult>({
          ok: true,
          toast: `${title} is now universal`,
        });
      }
      case "universal-remove": {
        const title = await productTitle(shop.id, input.productId);
        await removeUniversal(shop.id, input.productId);
        return data<MappingResult>({
          ok: true,
          toast: `${title} is no longer universal`,
        });
      }
    }
  } catch (error) {
    if (error instanceof LinkRuleError) {
      return data<MappingResult>(
        { ok: false, error: error.message },
        { status: 409 },
      );
    }
    console.error("product-mapping: action failed", {
      shop: session.shop,
      intent: input.intent,
      error,
    });
    return data<MappingResult>(
      { ok: false, error: NOT_SAVED },
      { status: 500 },
    );
  }
};

/** Fits column: the first row's values, "+n more" for the group's other rows (prototype). */
function fitsText(fields: RowField[], g: UnlinkedGroup) {
  const row = {
    id: "",
    attachment: g.attachment,
    linked: false,
    ...g.first,
  };
  const text = fields.map((f) => cellDisplay(f, row)).join(" · ");
  return g.rows > 1 ? `${text} +${g.rows - 1} more` : text;
}

const checkedToast = (n: number) =>
  n === 0
    ? "Links checked. No new matches"
    : `Links checked. ${n.toLocaleString("en-US")} new match${n === 1 ? "" : "es"}`;

type Picked = { id: string; variants?: { id?: string }[] }[] | undefined;

export default function ProductMappingPage() {
  const {
    noun,
    things,
    fields,
    unlinkedCount,
    unlinked,
    withoutData,
    universal,
    linkCheck,
  } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabParam(searchParams.get("tab"));
  const showTab = (key: TableKey) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (key === "u") next.delete("tab");
        else next.set("tab", key);
        return next;
      },
      { preventScrollReset: true, replace: true },
    );
  const fetcher = useFetcher<MappingResult>();
  const busy = fetcher.state !== "idle";
  // The table being paged shows its loading state; the others stay as they are.
  const [pagingKey, setPagingKey] = useState<TableKey | null>(null);
  const paging = (key: TableKey) =>
    navigation.state === "loading" && pagingKey === key;

  /** One table's page; a new rows-per-page value starts again at page 1. */
  const goToPage = (key: TableKey, page: number, size?: number) => {
    setPagingKey(key);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (page <= 1) next.delete(key);
        else next.set(key, String(page));
        if (size === DEFAULT_TABLE_PAGE_SIZE) next.delete(`${key}n`);
        else if (size !== undefined) next.set(`${key}n`, String(size));
        return next;
      },
      { preventScrollReset: true },
    );
  };

  const footer = (
    key: TableKey,
    list: { page: number; pageSize: number },
    total: number,
    what: string,
  ) => (
    <TableFooter
      total={total}
      page={list.page}
      pageSize={list.pageSize}
      pageSizes={TABLE_PAGE_SIZES}
      noun={what}
      disabled={paging(key)}
      onPage={(page) => goToPage(key, page)}
      onPageSize={(size) => goToPage(key, 1, size)}
    />
  );

  // ---- Check links again: wait for the run this page started, then toast its result. While a
  // check runs, only the small status endpoint is polled; the lists reload when it has ended.
  const [live, setLive] = useState<LinkCheckView>(linkCheck);
  useEffect(() => setLive(linkCheck), [linkCheck]);
  const checking = isActive(live);
  // The store's products are being loaded for the first time: link results aren't known yet.
  const firstLoad = !live.catalogReady;
  // First visit: the store's products are still loading (or that failed).
  const loadingState = checking ? (
    <EmptyState tone="loading" heading="Loading your products from Shopify…">
      This takes a moment for big stores. The list fills in by itself.
    </EmptyState>
  ) : (
    <EmptyState
      icon="alert-circle"
      heading="Your products couldn't be loaded yet"
    >
      Click Check links again to try again.
    </EmptyState>
  );
  const [watching, setWatching] = useState<number | null>(null);
  const idlePolls = useRef(0);
  useEffect(() => {
    if (!checking && watching === null) return;
    const t = setInterval(() => {
      fetch("/api/links/status")
        .then((res) => (res.ok ? (res.json() as Promise<LinkCheckView>) : null))
        .then((state) => {
          if (!state) return;
          setLive(state);
          if (isActive(state)) return;
          // A run ended: reload the lists (once; the loader brings the same state back).
          if (isActive(linkCheck) || state.attempt !== linkCheck.attempt) {
            if (revalidator.state === "idle") void revalidator.revalidate();
          }
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [checking, watching, linkCheck, revalidator]);
  useEffect(() => {
    if (watching === null || checking) return;
    if (live.attempt < watching) {
      // The requested rerun should be queued right after the running check; don't wait forever.
      if (++idlePolls.current > MAX_IDLE_POLLS) {
        setWatching(null);
        shopify.toast.show("Links couldn't be checked. Try again.", {
          isError: true,
        });
      }
      return;
    }
    idlePolls.current = 0;
    if (live.status === "completed") {
      shopify.toast.show(checkedToast(live.newMatches));
    } else if (live.status === "failed") {
      shopify.toast.show(
        live.error ?? "Links couldn't be checked. Try again.",
        {
          isError: true,
        },
      );
    }
    setWatching(null);
  }, [watching, live, checking, shopify]);

  // ---- action results
  useEffect(() => {
    const r = fetcher.data;
    if (fetcher.state !== "idle" || !r) return;
    if (!r.ok) shopify.toast.show(r.error, { isError: true });
    else {
      if (r.toast) shopify.toast.show(r.toast);
      if (r.attempt !== undefined) {
        idlePolls.current = 0;
        setWatching(r.attempt);
      }
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const submit = (form: Record<string, string>) =>
    fetcher.submit(form, { method: "post" });

  const choose = async (g: UnlinkedGroup) => {
    const collection = g.kind === "collection";
    const picked = (await shopify.resourcePicker({
      type: collection ? "collection" : "product",
      action: "select",
      multiple: false,
    })) as Picked;
    const item = picked?.[0];
    if (!item) return;
    const variants = (item.variants ?? []).filter((v) => v.id);
    submit({
      intent: "link",
      attachment: g.attachment,
      resourceId: item.id,
      // One variant picked (or the product has only one): link the row's SKU to it.
      ...(variants.length === 1 ? { variantId: variants[0].id! } : {}),
    });
  };

  const addProducts = async () => {
    const picked = (await shopify.resourcePicker({
      type: "product",
      action: "add",
      multiple: MAX_PICK,
      filter: { variants: false },
    })) as Picked;
    if (!picked?.length) return;
    submit({
      intent: "universal-add",
      ids: JSON.stringify(picked.map((p) => p.id)),
    });
  };

  const addRow = (p: { sku: string; handle: string }) =>
    navigate(
      `/app/filter-data?add=${encodeURIComponent(p.sku || productLinkAttachment(p.handle))}`,
    );

  return (
    <s-page inlineSize="base">
      <PageHeader title="Product mapping">
        <s-button
          variant="primary"
          icon="refresh"
          loading={
            checking || (busy && fetcher.formData?.get("intent") === "check")
          }
          onClick={() => submit({ intent: "check" })}
        >
          Check links again
        </s-button>
      </PageHeader>

      <s-stack gap="base">
        <div className="ff-tabs" role="tablist" aria-label="Product mapping">
          {TABS.map(([key, label, icon]) => {
            const count =
              key === "u"
                ? unlinkedCount
                : key === "p"
                  ? withoutData.total
                  : universal.total;
            // Counts mean nothing until the store's products have loaded (not for universal).
            const known = key === "x" || !firstLoad;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => showTab(key)}
              >
                <Icon name={icon} size={16} />
                {label}
                {known && (
                  <span
                    className={
                      key !== "x" && count > 0
                        ? "ff-tab-count is-warning"
                        : "ff-tab-count"
                    }
                  >
                    {count.toLocaleString("en-US")}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {tab === "u" && (
          <s-section padding="none" accessibilityLabel="Unlinked rows">
            <s-box padding="base">
              <s-stack gap="small-100">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <SectionTitle icon="link">Unlinked rows</SectionTitle>
                  {!firstLoad && (
                    <s-badge tone={unlinkedCount ? "warning" : "success"}>
                      {unlinkedCount.toLocaleString("en-US")} to link
                    </s-badge>
                  )}
                </s-stack>
                <s-text color="subdued">
                  Each filter row points to a product through its Attachment
                  (usually a SKU). We couldn&apos;t find these in your store, so
                  shoppers don&apos;t see them in search results.
                </s-text>
              </s-stack>
            </s-box>
            {firstLoad ? (
              loadingState
            ) : unlinked.items.length ? (
              <>
                <s-table loading={paging("u")}>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">
                      Attachment
                    </s-table-header>
                    <s-table-header>Type</s-table-header>
                    <s-table-header>Fits</s-table-header>
                    <s-table-header format="numeric">Rows</s-table-header>
                    <s-table-header>Action</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {unlinked.items.map((g) => (
                      <s-table-row key={g.attachment}>
                        <s-table-cell>
                          <s-text type="strong">{g.attachment}</s-text>
                        </s-table-cell>
                        <s-table-cell>{kindLabel(g.kind)}</s-table-cell>
                        <s-table-cell>
                          <s-text color="subdued">{fitsText(fields, g)}</s-text>
                        </s-table-cell>
                        <s-table-cell>
                          {g.rows.toLocaleString("en-US")}
                        </s-table-cell>
                        <s-table-cell>
                          <s-button
                            disabled={busy}
                            onClick={() => void choose(g)}
                          >
                            {g.kind === "collection"
                              ? "Choose collection"
                              : "Choose product"}
                          </s-button>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
                {footer("u", unlinked, unlinkedCount, "attachments")}
              </>
            ) : (
              <EmptyState
                tone="success"
                icon="check-circle"
                heading="Every row is linked to a product"
                actions={
                  <s-button onClick={() => navigate("/app/filter-data")}>
                    View filter data
                  </s-button>
                }
              >
                Shoppers can find all of your {things} in the search. Rows from
                new imports are matched automatically; any we can&apos;t match
                show up here.
              </EmptyState>
            )}
          </s-section>
        )}

        {tab === "p" && (
          <s-section
            padding="none"
            accessibilityLabel="Products without filter data"
          >
            <s-box padding="base">
              <s-stack gap="small-100">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <SectionTitle icon="product">
                    Products without filter data
                  </SectionTitle>
                  {!firstLoad && (
                    <s-badge tone={withoutData.total ? "warning" : "success"}>
                      {withoutData.total.toLocaleString("en-US")} products
                    </s-badge>
                  )}
                </s-stack>
                <s-text color="subdued">
                  These products have no filter rows, so they never appear in a
                  search. Add rows for them, or mark them as universal if they
                  fit every {noun}.
                </s-text>
              </s-stack>
            </s-box>
            {firstLoad ? (
              loadingState
            ) : withoutData.items.length ? (
              <>
                <s-table loading={paging("p")}>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Product</s-table-header>
                    <s-table-header>SKU</s-table-header>
                    <s-table-header>Action</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {withoutData.items.map((p) => (
                      <s-table-row key={p.productId}>
                        <s-table-cell>
                          <s-text type="strong">{p.title}</s-text>
                        </s-table-cell>
                        <s-table-cell>{p.sku || "—"}</s-table-cell>
                        <s-table-cell>
                          <s-stack direction="inline" gap="small-200">
                            <s-button onClick={() => addRow(p)}>
                              Add filter row
                            </s-button>
                            <s-button
                              variant="tertiary"
                              disabled={busy}
                              onClick={() =>
                                submit({
                                  intent: "universal-mark",
                                  productId: p.productId,
                                })
                              }
                            >
                              Mark as universal
                            </s-button>
                          </s-stack>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
                {footer("p", withoutData, withoutData.total, "products")}
              </>
            ) : (
              <EmptyState
                tone="success"
                icon="check-circle"
                heading="Every product has filter data or is universal"
                actions={
                  <s-button onClick={() => showTab("x")}>
                    View universal products
                  </s-button>
                }
              >
                Every active product in your store shows up in at least one
                search.
              </EmptyState>
            )}
          </s-section>
        )}

        {tab === "x" && (
          <s-section padding="none" accessibilityLabel="Universal products">
            <s-box padding="base">
              <s-grid
                gridTemplateColumns="1fr auto"
                gap="base"
                alignItems="center"
              >
                <s-stack gap="small-100">
                  <SectionTitle icon="globe">Universal products</SectionTitle>
                  <s-text color="subdued">
                    Shown in every search result, whatever the shopper picks.
                    For example tools, cleaning kits or cables.
                  </s-text>
                </s-stack>
                {/* Empty list: the empty state below has the button instead. */}
                {universal.items.length > 0 && (
                  <s-button
                    icon="plus"
                    disabled={busy}
                    onClick={() => void addProducts()}
                  >
                    Add products
                  </s-button>
                )}
              </s-grid>
            </s-box>
            {universal.items.length ? (
              <>
                <s-table loading={paging("x")}>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Product</s-table-header>
                    <s-table-header>SKU</s-table-header>
                    <s-table-header>Action</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {universal.items.map((p) => (
                      <s-table-row key={p.productId}>
                        <s-table-cell>
                          <s-text type="strong">
                            {p.title || "Unknown product"}
                          </s-text>
                        </s-table-cell>
                        <s-table-cell>{p.sku || "—"}</s-table-cell>
                        <s-table-cell>
                          <s-button
                            variant="tertiary"
                            disabled={busy}
                            onClick={() =>
                              submit({
                                intent: "universal-remove",
                                productId: p.productId,
                              })
                            }
                          >
                            Remove
                          </s-button>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
                {footer("x", universal, universal.total, "products")}
              </>
            ) : (
              <EmptyState
                icon="globe"
                heading="No universal products yet"
                actions={
                  <s-button
                    variant="primary"
                    icon="plus"
                    disabled={busy}
                    onClick={() => void addProducts()}
                  >
                    Add products
                  </s-button>
                }
              >
                Universal products show in every search result, whatever the
                shopper picks. For example tools, cleaning kits or cables.
              </EmptyState>
            )}
          </s-section>
        )}
      </s-stack>
    </s-page>
  );
}
