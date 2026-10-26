# UI rules

Design rules for every screen of the embedded admin app. They used to live in the UI prototype's README (`.claude/design/`, removed 2026-10-26: the built app replaced it as the reference). The agreed rules in `.claude/CLAUDE.md` apply too.

1. **Polaris first.** Polaris web components everywhere, as Shopify recommends for embedded apps. Section headings use the bolder style: `SectionTitle` (`app/components/SectionTitle.tsx`; Polaris size, weight 750) instead of `s-section heading`, because the Polaris heading text sits in shadow DOM and can't be made bolder; keep `accessibilityLabel` on the section. Inside a card, parts are headed with `s-heading` and separated by `s-divider`.
2. **Custom, eye-catching areas only where agreed** (list in `.claude/CLAUDE.md`). Everywhere else the light polish of `app/styles/theme.css`: tinted page background, lifted top-level cards, icon chips before section titles.
3. **Colours:** theme **Sky** (light blue; chosen 2026-10-05, `app/styles/theme.css`). Green means done/fits, amber means "needs attention".
4. **Narrow pages:** every page uses `s-page inlineSize="base"`.
5. **One store type per store** (Automotive, Phones and accessories, Beauty and personal care, Something else); search fields are fully dynamic after that.
6. **Notifications:** after an action (saved, deleted, imported, exported, linked) a Shopify toast — App Bridge `shopify.toast.show(message)`, `{ isError: true }` for errors. `s-banner` only for lasting states on a page.
7. **Confirm every delete** with a small Polaris `s-modal` (red primary button + Cancel). Never delete on one click.
8. **No AI features.** Automatic matching is rule-based (header names, SKUs).
9. **Dropdowns open below the field** (2026-10-16): the app uses `Select` / `Option` (`app/components/Select.tsx`) instead of `s-select` (the native `<select>`, which macOS draws over the field). Where a spec says `s-select`, read it as `Select`.
10. **Settings in a row**: related fields share a row (two or three columns); a checkbox that turns a group on or off comes last in its row and lines up with the fields' inputs (`.sp-opt-grid__check`); fields that do nothing while their checkbox is off are disabled.
