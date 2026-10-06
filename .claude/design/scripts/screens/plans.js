// Screen: Plans — current plan with usage, and the plans (Shopify Managed Pricing in the real app). Spec: .claude/specs/plans.md
const PLANS = [
  { key: 'starter', name: 'Starter', month: 0, limits: { rows: 5000, products: 50 }, sub: '50 products · 5,000 rows',
    items: ['Search section and Fits badge', 'CSV import with column mapping'] },
  { key: 'growth', name: 'Growth', month: 29, limits: { rows: 500000, products: 5000 }, sub: '5,000 products · 500,000 rows',
    items: ['Everything in Starter', 'Fitment table (also inside your theme tabs)', 'My Selection floating button', 'Universal products', 'Import history with 5 backups'] },
  { key: 'pro', name: 'Pro', month: 99, limits: { rows: Infinity, products: Infinity }, sub: 'Unlimited products and rows',
    items: ['Everything in Growth', 'Scheduled imports from a supplier feed', 'Search analytics', 'Priority support'] }
];

S.plans = () => {
  const sp = setup(), yearly = state.billing === 'year';
  const current = PLANS.find((p) => p.key === (state.plan || 'growth'));
  const fmt = (n) => n === Infinity ? 'Unlimited' : n.toLocaleString('en-US');
  const linked = new Set(sp.rows.filter((r) => r.mapped).map((r) => r.part)).size;
  const meter = (label, used, max) => `<s-stack gap="small-100">
      <s-grid gridTemplateColumns="1fr auto" gap="base"><s-text>${label}</s-text><s-text color="subdued">${fmt(used)} of ${fmt(max)}</s-text></s-grid>
      <div class="meter"><span style="width:${max === Infinity ? 2 : Math.max(2, Math.min(100, used / max * 100))}%"></span></div></s-stack>`;
  const price = (p) => p.month === 0 ? 'Free' : yearly ? '$' + (p.month * 10) : '$' + p.month;
  const per = (p) => p.month === 0 ? '' : yearly ? ' / year' : ' / month';

  return `<s-page heading="Plans" inlineSize="base">
  <s-stack gap="base">
  <s-section accessibilityLabel="Your plan"><s-grid gridTemplateColumns="minmax(0, 1fr) minmax(0, 1fr)" gap="large" alignItems="start">
    <s-stack gap="small-200">
      <s-stack direction="inline" gap="small-200" alignItems="center"><h2 class="sec-title">Your plan: ${current.name}</h2><s-badge tone="info">Free trial · 9 days left</s-badge></s-stack>
      <s-text color="subdued">Billed through Shopify on your Shopify invoice. You can change or cancel your plan any time.</s-text>
    </s-stack>
    <s-stack gap="base">
      ${meter('Filter rows', sp.rows.length, current.limits.rows)}
      ${meter('Linked products', linked, current.limits.products)}
    </s-stack>
  </s-grid></s-section>

  <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
    <s-text color="subdued">Every paid plan starts with a 14-day free trial.</s-text>
    <s-stack direction="inline" gap="small-200">
      <s-button variant="${yearly ? 'tertiary' : 'secondary'}" data-act="billing" data-val="month">Monthly</s-button>
      <s-button variant="${yearly ? 'secondary' : 'tertiary'}" data-act="billing" data-val="year">Yearly · 2 months free</s-button>
    </s-stack>
  </s-grid>

  <div class="plans">
    ${PLANS.map((p) => `<s-section accessibilityLabel="${p.name}"><s-stack gap="base">
      <s-stack direction="inline" gap="small-200" alignItems="center"><h2 class="sec-title">${p.name}</h2>${p === current ? '<s-badge tone="success">Current plan</s-badge>' : ''}</s-stack>
      <p class="price">${price(p)}<span>${per(p)}</span></p>
      <s-text color="subdued">${p.sub}</s-text>
      <s-unordered-list>${p.items.map((x) => `<s-list-item>${x}</s-list-item>`).join('')}</s-unordered-list>
      ${p === current ? '<s-button disabled>Current plan</s-button>' : `<s-button${PLANS.indexOf(p) > PLANS.indexOf(current) ? ' variant="primary"' : ''} data-act="plan-pick" data-val="${p.key}">${PLANS.indexOf(p) > PLANS.indexOf(current) ? 'Upgrade to ' : 'Switch to '}${p.name}</s-button>`}
    </s-stack></s-section>`).join('')}
  </div>
  </s-stack></s-page>`;
};
