# Settings

**Prototype:** `design/scripts/screens/settings.js` · **Suggested route:** `/app/settings`

## Purpose
App-wide settings that don't belong to one feature. There is no Labels or Translations section: storefront texts are written where they are used (placeholders on Search setup; the other texts on the Storefront tabs).

## Layout
1. **Store type** — current type + "Sets the starting fields and wording. Fields stay fully editable." + **Change** (`icon="store"`, → onboarding in change mode).
2. **Your data** — plain explanation, no actions: what we store (search fields, filter rows, product links, last 5 imported files, texts and settings); shoppers (My Selection lives in the shopper's browser; no names, emails or orders); backups (download the last 5 files from Search setup › Import history); if you uninstall (search disappears at once, data kept 30 days, then deleted); privacy requests (Shopify GDPR webhooks handled automatically). Products in Shopify are never changed.
3. **Help** — **Contact support** · **Help center**.
4. *(Prototype only)* **Reset this prototype** — Restore sample rows · Start over (confirms first).

No notification settings: import results are shown during the import itself. No export here: Filter data has Export, and Import history has file backups.

## Data / backend
- Uninstall: `app/uninstalled` webhook → mark shop; delete data after 30 days. Handle the mandatory GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`).
