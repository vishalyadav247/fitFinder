// Screen: Settings — store type, your data, help. Storefront texts are edited where they are used (Search setup, Storefront tabs). Spec: .claude/specs/settings.md
S.settings = () => {
  const sp = setup(), t = tpl();

  return `<s-page heading="Settings" inlineSize="base">
  <s-stack gap="base">
  <s-section accessibilityLabel="Store type"><h2 class="sec-title sec-gap">Store type</h2><s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
    <s-stack gap="none"><s-text type="strong">${t.label}</s-text><s-text color="subdued">Sets the starting fields and wording. Fields stay fully editable.</s-text></s-stack>
    <s-button icon="store" data-act="change-type">Change</s-button></s-grid></s-section>

  <s-section accessibilityLabel="Your data"><h2 class="sec-title sec-gap">Your data</h2>
    <s-stack gap="small-300">
      <s-text>FitFinder only stores what it needs to run your search. Your products in Shopify are never changed by the app.</s-text>
      <s-unordered-list>
        <s-list-item><s-text type="strong">What we store:</s-text> your search fields, filter rows, product links, the last 5 imported files (as backups) and the texts and settings you set in the app.</s-list-item>
        <s-list-item><s-text type="strong">Shoppers:</s-text> a shopper's My Selection is saved in their own browser, not on our servers. We don't store names, emails or orders.</s-list-item>
        <s-list-item><s-text type="strong">Backups:</s-text> you can download each of your last 5 imported files any time from Search setup › Import history.</s-list-item>
        <s-list-item><s-text type="strong">If you uninstall:</s-text> the search disappears from your store straight away. Your data is kept for 30 days in case you reinstall, then deleted for good.</s-list-item>
        <s-list-item><s-text type="strong">Privacy requests:</s-text> customer and shop data requests from Shopify (GDPR) are handled automatically.</s-list-item>
      </s-unordered-list>
    </s-stack>
  </s-section>

  <s-section accessibilityLabel="Help"><h2 class="sec-title sec-gap">Help</h2>
    <s-stack direction="inline" gap="small-200"><s-button icon="email">Contact support</s-button><s-button icon="external" variant="tertiary">Help center</s-button></s-stack>
  </s-section>

  <s-section accessibilityLabel="Reset this prototype"><h2 class="sec-title sec-gap">Reset this prototype</h2><s-stack gap="base"><s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center"><s-paragraph color="subdued">Puts the sample filter rows back. Your search fields and settings stay as they are.</s-paragraph><s-button data-act="load-sample">Restore sample rows</s-button></s-grid><s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center"><s-paragraph color="subdued">Clears everything in this browser and starts at onboarding again.</s-paragraph><s-button tone="critical" data-act="ask" data-confirm="reset">Start over</s-button></s-grid></s-stack></s-section>
  </s-stack>

  </s-page>`;
};
