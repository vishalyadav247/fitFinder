# Data model and API (suggested)

See also `.claude/BUILD-PLAN.md` (section 3) for the full table list. The prototype keeps everything in one browser object (`design/scripts/core/state.js`). This is the suggested shape for the real multi-shop app. Names are suggestions.

## Prototype shape (for reference)
```js
setup = {
  type: 'automotive' | 'phones' | 'beauty' | 'custom',
  noun: 'vehicle', heading: 'Find parts for your vehicle',
  fields: [{ id, label, placeholder, type: 'list' | 'years', required }],     // ordered
  rows:   [{ id, v: { [fieldId]: value }, part, mapped }],        // year range value: '2008-2011' or '2016-' (open)
  cols:   [{ id, name, samples, use }],                            // last file's columns; use = fieldId | fieldId+':from'|':to'|':range' | 'part' | 'skip'
  history: [{ file, when, mode, rows }]
}
state.sf = { theme, themeSetup, embed, layout, corners, btn, bg, text, labels, showHeading, button, saveLink, saveText, garage, reset, fitsText, noFitText, askText, badgeSel, noFitLink, noFitLinkText, tableStyle, tableTitle, tableOpen, tableLook, tableHide, tableSort, tableRows, tableEmpty, tableEmptyText, tablePlace, resetText, noResults, showAllText, msSelected, msAdd, hintTitle, hintSub, hintEmpty, hintEmptySub, garageName, savedPos, savedBg, savedText, savedIcon, savedIconUrl, savedCount, maxSaved, askSave }
```

## Tables (Postgres)
Implemented in `prisma/schema.prisma` (M1). Every app table has `shop_id` and cascades on shop delete.

| Table | Key columns | Notes |
|---|---|---|
| `shops` | `id`, `domain` (unique), `installed_at`, `uninstalled_at`, `last_auth_at`, `plan`, `trial_ends_at` | One row per installed shop. `last_auth_at` (last token exchange or admin visit) makes late `app/uninstalled` deliveries after a reinstall harmless. The access token lives in the Shopify `Session` table, not here |
| `search_configs` | `shop_id` (PK), `store_type`, `heading`, `noun`, `things_word` | One per shop (noun: vehicle/phone/profile/item; things: parts/accessories/products) |
| `search_fields` | `id`, `shop_id`, `position`, `label`, `placeholder`, `type` (`list`/`year_range`), `required` | Ordered |
| `fitment_rows` | `id`, `shop_id`, `values` (jsonb `{fieldId: value}`), `year_from`, `year_to`, `attachment`, `row_hash` (unique per shop) | `attachment` = SKU, product URL/handle or collection URL/handle. `row_hash` = hash(values + years + attachment) makes add-and-update imports and dedupe cheap |
| `product_links` | `shop_id`, `attachment`, `kind` (`sku`/`product`/`collection`), `product_id`, `variant_id`, `collection_id`, `method` (`auto`/`manual`) | Unique (`shop_id`, `attachment`) |
| `universal_products` | `shop_id`, `product_id` | |
| `import_mappings` | `shop_id`, `column_name`, `target` (`field:{id}`, `field:{id}:from/to/range`, `attachment`, `skip`) | Last saved mapping; pre-fills step 2 (Map columns) of the next import |
| `import_jobs` | `id`, `shop_id`, `file_name`, `file_key` (object storage key of the original upload; kept for the last 5 jobs per shop as a downloadable backup), `mode` (`upsert`/`replace`/`delete`), `mapping` (jsonb), `look_for_skus`, `has_header`, `status`, `added`, `updated`, `unchanged`, `deleted`, `not_found`, `errors`, `error_report_key`, `created_at`, `finished_at` | Search setup › Import history |
| `storefront_settings` | `shop_id`, `settings` (jsonb) | Mirror to an app metafield for the theme |
| `theme_status` | `shop_id`, `theme_id`, `embed_on`, `blocks` (jsonb), `table_code_found`, `checked_at` | Cache of what is added to each theme |

Indexes: (`shop_id`, `attachment`); (`shop_id`, `id`) for Filter data paging and export (M5); unique (`shop_id`, `row_hash`); GIN (`jsonb_path_ops`) on `values` for the cascading lookups (to be reworked per shop in M5, see PROGRESS.md). Shops can have 700k+ rows (Bilstein NL), so dropdown options should come from an index or a cached distinct-values table, not a full scan. `values` is a reserved word in Postgres: quote it (`"values"`) in raw SQL.

## Admin API (session-token authenticated)
| Method | Path | Used by |
|---|---|---|
| POST | `/app/onboarding` (route action) | Onboarding, change store type |
| GET | `/api/dashboard` | Dashboard |
| GET/PUT | `/api/search-fields` | Search setup · fields |
| POST/GET/PUT | `/api/imports` (upload), `/api/imports/{id}/mapping`, `/api/imports/{id}/preview`, `/api/imports/{id}/run`, `/api/imports?limit=5`, `/api/imports/{id}/file` | Search setup · import card and Import history |
| GET | `/api/fitment?q=&page=` (rows); add/edit/delete/delete-all/dedupe are intents of the `/app/filter-data` route action | Filter data |
| POST | `/api/fitment/export` `{ scope: all|selected|unmatched, ids? }` | Filter data · Export |
| POST/GET/PUT | `/api/links/check`, `/api/links/unlinked`, `/api/links/{attachment}`, `/api/products/without-fitment` | Product mapping |
| GET/PUT | `/api/universal-products` | Product mapping |
| GET/PUT | `/api/storefront-settings`, `/api/themes`, `/api/themes/{id}/status` | Storefront |

## Storefront API (app proxy `/apps/fitfinder/*`, signature-verified)
| Path | Returns |
|---|---|
| `GET options?field={id}&{fieldId}={value}…` | Values for the next dropdown |
| `GET search?{fieldId}={value}…` | Where "Show {products}" goes: `{ mode: "search", q }` = the theme's search page for the fitting SKUs, or `{ mode: "page" }` |
| `GET results?{fieldId}={value}…&page=` | FitFinder's own results page (Liquid in the theme layout): the fallback when the SKU list doesn't fit one search |
| `GET fits?product={id}&{fieldId}={value}…` | `fits` / `no-fit` for the product badge, plus fitment table rows |

## Webhooks
`app/uninstalled`, `products/update`, `products/delete`, `app_subscriptions/update`, and the mandatory GDPR topics `customers/data_request`, `customers/redact`, `shop/redact`.
