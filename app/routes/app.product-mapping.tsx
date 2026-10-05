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
import styles from "../styles/product-mapping.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

const POLL_MS = 2000;
const MAX_IDLE_POLLS = 15;

const isActive = (s: { status: string }) =>
  s.status === "queued" || s.status === "running";

const pageParam = (url: URL, key: string) => {
  const n = Number(url.searchParams.get(key) ?? 1);
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : 1;
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
  const [fields, counts, unlinked, withoutData, universal] = await Promise.all([
    listRowFields(shop.id),
    rowCounts(shop.id),
    unlinkedGroups(shop.id, pageParam(url, "u")),
    productsWithoutData(shop.id, pageParam(url, "p")),
    universalProducts(shop.id, pageParam(url, "x")),
  ]);
  return {
    noun: config.noun,
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
  const [, setSearchParams] = useSearchParams();
  const fetcher = useFetcher<MappingResult>();
  const busy = fetcher.state !== "idle";
  // The table being paged shows its loading state; the others stay as they are.
  const [pagingKey, setPagingKey] = useState<"u" | "p" | "x" | null>(null);
  const paging = (key: "u" | "p" | "x") =>
    navigation.state === "loading" && pagingKey === key;

  const goToPage = (key: "u" | "p" | "x", page: number) => {
    setPagingKey(key);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (page <= 1) next.delete(key);
        else next.set(key, String(page));
        return next;
      },
      { preventScrollReset: true },
    );
  };

  // ---- Check links again: wait for the run this page started, then toast its result. While a
  // check runs, only the small status endpoint is polled; the lists reload when it has ended.
  const [live, setLive] = useState<LinkCheckView>(linkCheck);
  useEffect(() => setLive(linkCheck), [linkCheck]);
  const checking = isActive(live);
  // The store's products are being loaded for the first time: link results aren't known yet.
  const firstLoad = !live.catalogReady;
  const notLoaded = checking
    ? "Loading your products from Shopify…"
    : "Your products couldn't be loaded yet. Click Check links again.";
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
    <s-page heading="Product mapping" inlineSize="base">
      <s-button
        slot="primary-action"
        variant="primary"
        icon="refresh"
        loading={
          checking || (busy && fetcher.formData?.get("intent") === "check")
        }
        onClick={() => submit({ intent: "check" })}
      >
        Check links again
      </s-button>

      <s-stack gap="base">
        <s-section padding="none" accessibilityLabel="Unlinked rows">
          <s-box padding="base">
            <s-stack gap="small-100">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <h2 className="ff-sec-title">Unlinked rows</h2>
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
            <s-box padding="base" paddingBlockStart="none">
              <s-text color="subdued">{notLoaded}</s-text>
            </s-box>
          ) : unlinked.items.length ? (
            <s-table
              paginate={unlinked.page > 1 || unlinked.hasNextPage}
              loading={paging("u")}
              hasPreviousPage={unlinked.page > 1}
              hasNextPage={unlinked.hasNextPage}
              onPreviousPage={() => goToPage("u", unlinked.page - 1)}
              onNextPage={() => goToPage("u", unlinked.page + 1)}
            >
              <s-table-header-row>
                <s-table-header listSlot="primary">Attachment</s-table-header>
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
                      <s-button disabled={busy} onClick={() => void choose(g)}>
                        {g.kind === "collection"
                          ? "Choose collection"
                          : "Choose product"}
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          ) : (
            <s-box padding="base" paddingBlockStart="none">
              <s-banner
                tone="success"
                heading="Every row is linked to a product"
              ></s-banner>
            </s-box>
          )}
        </s-section>

        <s-section
          padding="none"
          accessibilityLabel="Products without filter data"
        >
          <s-box padding="base">
            <s-stack gap="small-100">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <h2 className="ff-sec-title">Products without filter data</h2>
                {!firstLoad && (
                  <s-badge tone={withoutData.total ? "warning" : "success"}>
                    {withoutData.total.toLocaleString("en-US")} products
                  </s-badge>
                )}
              </s-stack>
              <s-text color="subdued">
                These products have no filter rows, so they never appear in a
                search. Add rows for them, or mark them as universal if they fit
                every {noun}.
              </s-text>
            </s-stack>
          </s-box>
          {firstLoad ? (
            <s-box padding="base" paddingBlockStart="none">
              <s-text color="subdued">{notLoaded}</s-text>
            </s-box>
          ) : withoutData.items.length ? (
            <s-table
              paginate={withoutData.page > 1 || withoutData.hasNextPage}
              loading={paging("p")}
              hasPreviousPage={withoutData.page > 1}
              hasNextPage={withoutData.hasNextPage}
              onPreviousPage={() => goToPage("p", withoutData.page - 1)}
              onNextPage={() => goToPage("p", withoutData.page + 1)}
            >
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
          ) : (
            <s-box padding="base" paddingBlockStart="none">
              <s-banner
                tone="success"
                heading="Every product has filter data or is universal"
              ></s-banner>
            </s-box>
          )}
        </s-section>

        <s-section padding="none" accessibilityLabel="Universal products">
          <s-box padding="base">
            <s-grid
              gridTemplateColumns="1fr auto"
              gap="base"
              alignItems="center"
            >
              <s-stack gap="small-100">
                <h2 className="ff-sec-title">Universal products</h2>
                <s-text color="subdued">
                  Shown in every search result, whatever the shopper picks. For
                  example tools, cleaning kits or cables.
                </s-text>
              </s-stack>
              <s-button
                icon="plus"
                disabled={busy}
                onClick={() => void addProducts()}
              >
                Add products
              </s-button>
            </s-grid>
          </s-box>
          {universal.items.length ? (
            <s-table
              paginate={universal.page > 1 || universal.hasNextPage}
              loading={paging("x")}
              hasPreviousPage={universal.page > 1}
              hasNextPage={universal.hasNextPage}
              onPreviousPage={() => goToPage("x", universal.page - 1)}
              onNextPage={() => goToPage("x", universal.page + 1)}
            >
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
          ) : (
            <s-box padding="base" paddingBlockStart="none">
              <s-text color="subdued">No universal products yet.</s-text>
            </s-box>
          )}
        </s-section>
      </s-stack>
    </s-page>
  );
}
