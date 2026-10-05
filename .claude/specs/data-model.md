# Data model and API (suggested)

See also `.claude/BUILD-PLAN.md` (section 3) for the full table list. The prototype keeps everything in one browser object (`design/scripts/core/state.js`). This is the suggested shape for the real multi-shop app. Names are suggestions.

## Prototype shape (for reference)
```js
setup = {
  type: 'automotive' | 'phones' | 'beauty' | 'custom',
  noun: 'vehicle', heading: 'Find parts for your vehicle',
  fields: [{ id, label, placeholder, type: 'list' | 'years', required }],     // ordered
  rows:   [{ id, v: { [fieldId]: value }, part, mapped }],        // year range value: '2008-2011' or '2016-' (open)
  cols:   [{ id, name, samples, use, newName }],                   // last file's columns; use = fieldId | fieldId+':from'|':to'|':range' | 'part' | 'new' | 'skip'
  history: [{ file, when, mode, rows }]
}
state.sf = { theme, themeSetup, embed, layout, corners, btn, bg, text, labels, showHeading, button, saveLink, saveText, garage, reset, fitsText, noFitText, askText, badgeSel, noFitLink, noFitLinkText, tableStyle, tableTitle, tableOpen, tableLook, tableHide, tableSort, tableRows, tableEmpty, tableEmptyText, tablePlace, resetText, noResults, showAllText, msSelected, msAdd, hintTitle, hintSub, hintEmpty, hintEmptySub, garageName, savedPos, savedBg, savedText, savedIcon, savedIconUrl, savedCount, maxSaved, askSave }
```

## Tables (Postgres)
| Table | Key columns | Notes |
|---|---|---|
| `shops` | `id`, `domain` (unique), `access_token` (encrypted), `installed_at`, `uninstalled_at` | One row per installed shop |
| `search_configs` | `shop_id` (PK), `store_type`, `heading`, `noun`, `things_word` | One per shop (noun: vehicle/phone/profile/item; things: parts/accessories/products) |
| `search_fields` | `id`, `shop_id`, `position`, `label`, `placeholder`, `type` (`list`/`year_range`), `required` | Ordered |
| `fitment_rows` | `id`, `shop_id`, `values` (jsonb `{fieldId: value}`), `year_from`, `year_to`, `part_number`, `note`, `row_hash` (unique per shop) | `row_hash` makes add-and-update imports and dedupe cheap |
| `product_links` | `shop_id`, `part_number`, `product_id`, `variant_id`, `method` | Unique (`shop_id`, `part_number`) |
| `universal_products` | `shop_id`, `product_id` | |
| `import_mappings` | `shop_id`, `column_name`, `use` (`field:{id}`, `field:{id}:from/to/range`, `sku`, `skip`) | Last saved mapping; pre-fills step 2 (Map columns) of the next import |
| `import_jobs` | `id`, `shop_id`, `file_name`, `file_url` (original upload; kept for the last 5 jobs per shop as a downloadable backup), `mode` (`upsert`/`replace`/`delete`), `mapping` (jsonb), `status`, `added`, `updated`, `unchanged`, `deleted`, `not_found`, `errors`, `error_report_url`, `created_at` | Search setup › Import history |
| `storefront_settings` | `shop_id`, `settings` (jsonb) | Mirror to an app metafield for the theme |

Indexes: (`shop_id`, `part_number`); expression or GIN indexes on `values` for the cascading lookups. Shops can have 700k+ rows (Bilstein NL), so dropdown options should come from an index or a cached distinct-values table, not a full scan.

## Admin API (session-token authenticated)
| Method | Path | Used by |
|---|---|---|
| POST | `/api/setup` | Onboarding, change store type |
| GET | `/api/dashboard` | Dashboard |
| GET/PUT | `/api/search-fields` | Search setup · fields |
| POST/GET/PUT | `/api/imports` (upload), `/api/imports/{id}/mapping`, `/api/imports/{id}/preview`, `/api/imports/{id}/run`, `/api/imports?limit=5`, `/api/imports/{id}/file` | Search setup · import card and Import history |
| GET/POST/PUT/DELETE | `/api/fitment`, `/api/fitment/{id}`, `/api/fitment/all`, `/api/fitment/dedupe` | Filter data |
| GET | `/api/fitment/export?scope=all|selected|unmatched&ids=` | Filter data · Export |
| POST/GET/PUT | `/api/links/check`, `/api/links/unlinked`, `/api/links/{attachment}`, `/api/products/without-fitment` | Product mapping |
| GET/PUT | `/api/universal-products` | Product mapping |
| GET/PUT | `/api/storefront-settings`, `/api/themes`, `/api/themes/{id}/status` | Storefront |

## Storefront API (app proxy `/apps/fitfinder/*`, signature-verified)
| Path | Returns |
|---|---|
| `GET options?field={id}&{fieldId}={value}…` | Values for the next dropdown |
| `GET results?{fieldId}={value}…` | Matching product ids, or a redirect to the filtered collection/search page |
| `GET fits?product={id}&{fieldId}={value}…` | `fits` / `no-fit` for the product badge, plus fitment table rows |

## Webhooks
`app/uninstalled`, `products/update`, `products/delete`, `app_subscriptions/update`, and the mandatory GDPR topics `customers/data_request`, `customers/redact`, `shop/redact`.
