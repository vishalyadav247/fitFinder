// Screen: Onboarding — "What does your store sell?". Spec: .claude/specs/onboarding.md
S.onboarding = () => {
  const c = state.choice, t = TEMPLATES[c];
  return `<s-page heading="Welcome to FitFinder" inlineSize="base">
  ${state.setup ? `<s-banner tone="warning" heading="Changing your store type replaces your search fields and filter data">Export your data first if you want to keep it. <s-link data-go="settings">Keep my current setup</s-link></s-banner>` : ''}
  <s-section>
    <s-stack gap="base">
      <s-stack direction="inline" gap="small" alignItems="center"><s-badge tone="info">Step 1 of 2</s-badge><s-heading>What kind of products does your store sell?</s-heading></s-stack>
      <s-paragraph color="subdued">We'll set up search fields that fit. You can rename, add or remove fields any time.</s-paragraph>
      <div class="types" role="radiogroup" aria-label="Store type">
        ${Object.entries(TEMPLATES).map(([k, x]) => `<button class="type" role="radio" aria-checked="${k === c}" data-act="choose" data-tpl="${k}">
          <span style="display:flex;justify-content:space-between;width:100%"><span class="tile lg ${x.tile}">${svg(x.icon, 20)}</span>${k === c ? '<s-badge tone="success" icon="check-circle">Selected</s-badge>' : ''}</span>
          <b>${x.label}</b><span style="color:#616161">${x.blurb}</span></button>`).join('')}
      </div>
    </s-stack>
  </s-section>
  <s-section accessibilityLabel="Your shoppers will search by"><h2 class="sec-title sec-gap">Your shoppers will search by</h2>
    <s-stack gap="base">${chips(t.fields.map((f) => f[0]))}
      <s-paragraph color="subdued">${c === 'custom' ? 'For example, a printer shop could use Brand › Series › Model, and an appliance shop Brand › Type › Model number.' : `Your store will show “Search Widget” with ${t.fields.length} dropdowns.`}</s-paragraph>
      <s-stack direction="inline" justifyContent="end"><s-button variant="primary" data-act="confirm-setup">${state.setup ? 'Replace my setup' : 'Continue'}</s-button></s-stack>
    </s-stack>
  </s-section></s-page>`;
};
