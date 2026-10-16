// Screen: Settings — store type, custom CSS, your data, help. Storefront texts are edited where they are used (Search setup, Storefront tabs). Spec: .claude/specs/settings.md
S.settings = () => {
  const sp = setup(), t = tpl();
  const locked = !!state.cssLocked;
  const tab = state.settingsTab === 'css' ? 'css' : 'general';

  return `<s-page heading="Settings" inlineSize="base">
  <s-stack gap="base">
  <div class="tabs tabs--compact" role="tablist" aria-label="Settings">${[['general', 'General'], ['css', 'Custom CSS']].map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-act="settings-tab" data-val="${k}">${l}</button>`).join('')}</div>
  ${tab === 'css' ? `
  <s-section accessibilityLabel="Custom CSS"><h2 class="sec-title sec-gap">Custom CSS</h2><s-stack gap="base">
    <s-text color="subdued">Small style changes for SpareFit on your store: the search widget, Fits badge, fitment table and My Selection button. Your CSS only applies to SpareFit, so it can&#39;t change the rest of your theme.</s-text>
    ${locked ? '<s-banner tone="info" heading="Custom CSS needs the Growth plan">Upgrade to style SpareFit on your store with your own CSS.<s-button slot="secondary-actions" data-go="plans">Compare plans</s-button></s-banner>' : ''}
    ${(state.cssDropped || []).length ? `<s-banner tone="warning" heading="Some of your CSS was left out" dismissible>Not used on your store: ${esc(state.cssDropped.join(', '))}. Only rules for SpareFit&#39;s classes, @media, @supports and @container work here.</s-banner>` : ''}
    <s-text-area label="CSS" rows="10" maxLength="5000" data-act="css-input" value="${esc(state.css || '')}" placeholder=".sp-sfw__go {&#10;  text-transform: uppercase;&#10;}" details="Up to 5,000 characters. @import, @font-face and other global rules are left out."${locked ? ' disabled' : ''}></s-text-area>
    <s-stack direction="inline"><s-button variant="tertiary" data-act="css-lock">${locked ? 'Prototype: plan includes Custom CSS' : 'Prototype: plan without Custom CSS'}</s-button></s-stack>
    <div class="savebar" data-savebar hidden><span>Unsaved changes</span><span class="savebar-actions"><button type="button" data-act="css-discard">Discard</button><button type="button" class="primary" data-act="css-save">Save</button></span></div>
  </s-stack></s-section>
  ` : `
  <s-section accessibilityLabel="Store type"><h2 class="sec-title sec-gap">Store type</h2><s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
    <s-stack gap="none"><s-text type="strong">${t.label}</s-text><s-text color="subdued">Sets the starting fields and wording. Fields stay fully editable.</s-text></s-stack>
    <s-button icon="store" data-act="change-type">Change</s-button></s-grid></s-section>

  <s-section accessibilityLabel="Your data"><h2 class="sec-title sec-gap">Your data</h2>
    <s-stack gap="small-300">
      <s-text>SpareFit only stores what it needs to run your search. Your products in Shopify are never changed by the app.</s-text>
      <s-unordered-list>
        <s-list-item><s-text type="strong">What we store:</s-text> · your search fields, filter rows, product links, the last 5 imported files (as backups) and the texts and settings you set in the app.</s-list-item>
        <s-list-item><s-text type="strong">Shoppers:</s-text> · a shopper's My Selection is saved in their own browser, not on our servers. We don't store names, emails or orders.</s-list-item>
        <s-list-item><s-text type="strong">Backups:</s-text> · you can download each of your last 5 imported files any time from Search setup › Import history.</s-list-item>
        <s-list-item><s-text type="strong">If you uninstall:</s-text> · the search disappears from your store straight away. Your data is kept for 30 days in case you reinstall, then deleted for good.</s-list-item>
        <s-list-item><s-text type="strong">Privacy requests:</s-text> · customer and shop data requests from Shopify (GDPR) are handled automatically.</s-list-item>
      </s-unordered-list>
    </s-stack>
  </s-section>

  <s-section accessibilityLabel="Help"><h2 class="sec-title sec-gap">Help</h2>
    <s-stack gap="small-300"><s-text>Need a hand? Chat with our support team right here in SpareFit.</s-text><s-unordered-list><s-list-item>Click the <s-text type="strong">chat button</s-text> on the right side of the screen to start a conversation.</s-list-item><s-list-item>Ask us anything: setting up your search, importing fitment data, linking products, adding SpareFit to your theme or your plan.</s-list-item><s-list-item>Your messages stay in the chat, so you can close it and pick up the conversation later.</s-list-item></s-unordered-list></s-stack>
  </s-section>

  <s-section accessibilityLabel="Feedback"><h2 class="sec-title sec-gap">Feedback</h2><s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center"><s-text color="subdued">We value your feedback! It helps us make SpareFit better. Let us know how we're doing.</s-text><s-button icon="star" href="https://apps.shopify.com/search?q=SpareFit" target="_blank">Write a review</s-button></s-grid></s-section>
  `}

  <s-section accessibilityLabel="Reset this prototype"><h2 class="sec-title sec-gap">Reset this prototype</h2><s-stack gap="base"><s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center"><s-paragraph color="subdued">Puts the sample filter rows back. Your search fields and settings stay as they are.</s-paragraph><s-button data-act="load-sample">Restore sample rows</s-button></s-grid><s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center"><s-paragraph color="subdued">Clears everything in this browser and starts at onboarding again.</s-paragraph><s-button tone="critical" data-act="ask" data-confirm="reset">Start over</s-button></s-grid></s-stack></s-section>
  </s-stack>

  </s-page>`;
};
