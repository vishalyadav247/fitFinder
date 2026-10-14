// Screen: Analytics — how shoppers use the search (sample numbers; the real app counts app proxy
// searches and fits checks per day). Spec: .claude/specs/analytics.md
S.analytics = () => {
  const sp = setup(), days = Number(state.anDays || 30);
  const things = tpl().things || 'products', head = esc(sp.fields.map((f) => f.label).join(' › '));
  const fmt = (n) => n.toLocaleString('en-US');
  // Seeded sample numbers, stable between renders.
  let seed = days * 7 + sp.rows.length;
  const rnd = (n) => { seed = (seed * 9301 + 49297) % 233280; return Math.floor((seed / 233280) * n); };
  const year = (v) => String(v || '').split('-')[0];
  const sel = (r) => sp.fields.map((f) => f.type === 'years' ? year(r.v[f.id]) : r.v[f.id]).filter(Boolean).join(' › ');
  const rows = sp.rows.slice(0, 12);
  const selections = rows.map((r) => ({ label: sel(r), searches: 4 + rnd(40) * (days / 7), none: r.mapped ? 0 : 1 + rnd(9) }))
    .sort((a, b) => b.searches - a.searches);
  const daily = Array.from({ length: days }, (_, i) => 6 + rnd(18) + Math.round(i / 3));
  const total = daily.reduce((n, d) => n + d, 0), max = Math.max(...daily);
  const none = selections.reduce((n, s) => n + s.none, 0);
  const found = total ? Math.round(((total - none) / total) * 100) : 0;
  const fieldId = state.anField || (sp.fields[0] || {}).id;
  const field = sp.fields.find((f) => f.id === fieldId) || sp.fields[0];
  const values = {};
  rows.forEach((r) => { const v = field.type === 'years' ? year(r.v[field.id]) : r.v[field.id]; if (v) values[v] = (values[v] || 0) + 5 + rnd(30); });
  const top = Object.entries(values).sort((a, b) => b[1] - a[1]).slice(0, 10), topMax = top.length ? top[0][1] : 1;
  // Sample product names: the store's own sample SKUs (no store-type words).
  const products = [...new Set(sp.rows.map((r) => r.part))].slice(0, 4).map((sku) => ({ t: 'Product ' + esc(sku), fits: 5 + rnd(60), no: rnd(25) }));
  const checks = products.reduce((n, p) => n + p.fits + p.no, 0), fits = products.reduce((n, p) => n + p.fits, 0);
  const shortDay = (i) => { const d = new Date(); d.setDate(d.getDate() - (days - 1 - i)); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  const sec = (title, body, right = '') => `<s-section><s-stack gap="base">
    ${right ? `<s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center"><h2 class="sec-title">${title}</h2>${right}</s-grid>` : `<h2 class="sec-title">${title}</h2>`}
    ${body}</s-stack></s-section>`;
  const card = (label, value, badge, line) => `<div class="ov-card an-card"><span class="ov-label">${label}</span>
    <span class="ov-value"><span class="metric-value">${value}</span>${badge}</span><span class="ov-line">${esc(line)}</span></div>`;
  const nothing = selections.filter((s) => s.none).sort((a, b) => b.none - a.none).slice(0, 10);

  return `<s-page heading="Analytics" inlineSize="base">
  <s-stack gap="base">
  <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center"><span></span>
    <s-select label="Period" labelAccessibilityVisibility="exclusive" data-act="an-days" value="${days}">
      <s-option value="7">Last 7 days</s-option><s-option value="30">Last 30 days</s-option><s-option value="90">Last 90 days</s-option>
    </s-select></s-grid>
  <div class="ov">
    ${card('Searches', fmt(total), '', `+12% vs the previous ${days} days`)}
    ${card('Found products', found + '%', none ? '<s-badge tone="warning">Needs attention</s-badge>' : '', none ? `${fmt(none)} searches found nothing` : 'Every search found products')}
    ${card('Different selections', fmt(selections.length), '', 'Searched at least once')}
    ${card('Product page checks', fmt(checks), '', checks ? `${Math.round((fits / checks) * 100)}% fit the shopper's selection` : 'No product page opened with a selection')}
  </div>
  ${sec('Searches per day', `<div class="an-chart"><p class="an-readout"><b>${fmt(total)}</b> searches · up to ${fmt(max)} a day</p>
    <div class="an-plot"><span class="an-grid" style="bottom:100%"><i>${max}</i></span><span class="an-grid" style="bottom:50%"><i>${Math.round(max / 2)}</i></span><span class="an-grid is-base" style="bottom:0"><i>0</i></span>
    <div class="an-bars">${daily.map((d, i) => `<button type="button" class="an-bar" title="${shortDay(i)} · ${d} searches"><span style="height:${(d / max) * 100}%"></span></button>`).join('')}</div></div>
    <div class="an-axis"><span>${shortDay(0)}</span><span>${shortDay(Math.floor((days - 1) / 2))}</span><span>${shortDay(days - 1)}</span></div></div>`)}
  ${sec('Searches that found nothing', nothing.length ? `<s-text color="subdued">Shoppers searched for these, but no ${things} were shown: the SKUs in their filter rows aren't linked to an active product. Link them in Product mapping.</s-text>
    <s-table><s-table-header-row><s-table-header listSlot="primary">${head}</s-table-header><s-table-header format="numeric">Found nothing</s-table-header><s-table-header>Last time</s-table-header><s-table-header>Now</s-table-header></s-table-header-row>
    <s-table-body>${nothing.map((s, i) => `<s-table-row><s-table-cell>${esc(s.label)}</s-table-cell><s-table-cell>${s.none}</s-table-cell><s-table-cell>${shortDay(days - 1 - i)}</s-table-cell><s-table-cell>${i % 3 === 2 ? '<s-badge tone="success">Finds products</s-badge>' : '<s-badge tone="warning">Still nothing</s-badge>'}</s-table-cell></s-table-row>`).join('')}</s-table-body></s-table>`
    : `<s-text color="subdued">Every search in this period found ${things}.</s-text>`, nothing.length ? '<s-button data-go="mapping">Open product mapping</s-button>' : '')}
  ${sec('Top searches', `<s-text color="subdued">What shoppers searched most. Keep their filter rows complete and their ${things} in stock.</s-text>
    <s-table><s-table-header-row><s-table-header listSlot="primary">${head}</s-table-header><s-table-header format="numeric">Searches</s-table-header><s-table-header format="numeric">Found nothing</s-table-header></s-table-header-row>
    <s-table-body>${selections.slice(0, 10).map((s) => `<s-table-row><s-table-cell>${esc(s.label)}</s-table-cell><s-table-cell>${fmt(s.searches)}</s-table-cell><s-table-cell>${s.none || '—'}</s-table-cell></s-table-row>`).join('')}</s-table-body></s-table>`)}
  ${sec('Most searched by field', `<s-table><s-table-header-row><s-table-header listSlot="primary">${esc(field.label)}</s-table-header><s-table-header format="numeric">Searches</s-table-header><s-table-header>Share</s-table-header></s-table-header-row>
    <s-table-body>${top.map(([v, n]) => `<s-table-row><s-table-cell>${esc(v)}</s-table-cell><s-table-cell>${fmt(n)}</s-table-cell><s-table-cell><div class="meter an-share"><span style="width:${Math.max(2, (n / topMax) * 100)}%"></span></div></s-table-cell></s-table-row>`).join('')}</s-table-body></s-table>`,
    `<s-select label="Search field" labelAccessibilityVisibility="exclusive" data-act="an-field" value="${field.id}">${sp.fields.map((f) => `<s-option value="${f.id}">${esc(f.label)}</s-option>`).join('')}</s-select>`)}
  ${sec('Product pages', `<s-text color="subdued">How often shoppers opened a product page with a selection, and whether the product fits it. Many "doesn't fit" checks can mean the product is missing filter rows for what your shoppers select.</s-text>
    <s-table><s-table-header-row><s-table-header listSlot="primary">Product</s-table-header><s-table-header format="numeric">Checks</s-table-header><s-table-header format="numeric">Fits</s-table-header><s-table-header format="numeric">Doesn't fit</s-table-header></s-table-header-row>
    <s-table-body>${products.sort((a, b) => (b.fits + b.no) - (a.fits + a.no)).map((p) => `<s-table-row><s-table-cell>${p.t}</s-table-cell><s-table-cell>${p.fits + p.no}</s-table-cell><s-table-cell>${p.fits}</s-table-cell><s-table-cell>${p.no || '—'}</s-table-cell></s-table-row>`).join('')}</s-table-body></s-table>`)}
  <s-text color="subdued">Days are in UTC and counts are kept for 180 days. SpareFit only counts searches; it records nothing about your shoppers.</s-text>
  </s-stack></s-page>`;
};
