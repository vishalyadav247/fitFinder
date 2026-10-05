// Screen: Dashboard — banner, setup guide and summary cards. Spec: .claude/specs/dashboard.md
S.home = () => {
  const sp = setup(), t = tpl();
  const un = sp.rows.filter((r) => !r.mapped).length;
  const first = sp.rows[0];
  const done = [true, sp.rows.length > 0, sp.rows.length > 0 && un === 0, !!sf().embed, false];
  const steps = [
    ['Search setup', 'Set up your search', `Shoppers search by ${sp.fields.map((f) => f.label).join(' › ')}. Rename, reorder or add fields any time, and the changes show on your store right away.`, 'fields', 'Open search setup', 'fields'],
    ['Import data', 'Import your filter data', sp.rows.length ? `${sp.rows.length} rows are in. Import your file again any time: new rows are added, changed rows are updated and nothing else is lost.` : 'Upload a CSV with your SKUs and the items they fit. Any column layout works, and you check the columns before importing.', 'import', 'Import data', 'upload'],
    ['Link products', 'Link SKUs to products', un ? `${un} SKU${un === 1 ? ' has' : 's have'} no product yet. Shoppers won't see ${un === 1 ? 'it' : 'them'} until ${un === 1 ? 'it is' : 'they are'} linked to a product in your store.` : `Every SKU is linked to a product, so shoppers can find all of your ${t.things || 'products'} in the search.`, 'mapping', 'Review links', 'link'],
    ['Go live', 'Add the search to your store', 'Add the search block to your home page and the fits badge to product pages in the theme editor. It only takes a few clicks.', 'store', 'Open storefront settings', 'store'],
    ['Plan', 'Choose a plan', 'You are on the Growth trial. Pick the plan that suits your catalog to keep the search running on your store after the trial ends.', 'plans', 'Compare plans', 'plans']];
  const doneCount = done.filter(Boolean).length;
  const cur = Number.isInteger(state.guide) ? state.guide : Math.max(0, done.indexOf(false));
  const [, title, desc, go, cta, ic] = steps[cur];
  return `<s-page heading="Dashboard" inlineSize="base">
  <section class="hero">
    <div>
      <span class="eyebrow">${svg(t.icon, 14)} ${esc(t.label)}</span>
      <h1>${esc(sp.heading)}</h1>
      <p class="lead">Shoppers pick their ${esc(sp.noun)} by ${esc(sp.fields.map((f) => f.label.toLowerCase()).join(', '))} and only see ${esc(t.things || 'products')} that fit. Fewer wrong orders, fewer returns.</p>
      <div class="actions"><button class="hbtn main" data-go="store">Add search to your store</button><button class="hbtn alt" data-go="fields">Open search setup</button></div>
    </div>
    <div class="how">
      <p class="how-title">How it works</p>
      <ol class="how-list">
        ${[[t.icon, 'Shopper picks their ' + sp.noun, sp.fields.map((f) => f.label).join(' › ')], ['rows', 'FitFinder matches', sp.rows.length + ' filter rows'], ['check', 'Only ' + (t.things || 'products') + ' that fit', 'Fewer wrong orders and returns']].map(([ic, title, sub], i) =>
          `<li class="how-step s${i + 1}"><span class="how-ico">${svg(ic, 16, 2.2)}</span><div><b>${esc(title)}</b><span>${esc(sub)}</span></div></li>`).join('')}
      </ol>
    </div>
  </section>
  <s-section padding="none">
    <div class="guide">
      <div class="g-head">
        <div class="g-ring" role="img" aria-label="${doneCount} of 5 steps done">
          <svg width="52" height="52" viewBox="0 0 52 52"><defs><linearGradient id="gr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--p)"/><stop offset="1" style="stop-color:var(--a)"/></linearGradient></defs>
            <circle cx="26" cy="26" r="21" fill="none" stroke="#E5E7EB" stroke-width="5"/>
            <circle cx="26" cy="26" r="21" fill="none" stroke="url(#gr)" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(doneCount / 5) * 131.9} 131.9" transform="rotate(-90 26 26)"/></svg>
          <span>${doneCount}/5</span>
        </div>
        <div><h2>${doneCount === 5 ? 'You’re all set' : 'Setup guide'}</h2><p>${doneCount === 5 ? 'Your search is live on your store.' : 'Finish these steps to show the search on your store.'}</p></div>
        <button class="g-toggle" data-act="guide-toggle" aria-expanded="${!state.guideClosed}" aria-label="${state.guideClosed ? 'Show' : 'Hide'} setup guide">${svg(state.guideClosed ? 'down' : 'up', 18, 2.2)}</button>
      </div>
      ${state.guideClosed ? '' : `
      <div class="g-seg" aria-hidden="true">${steps.map((x, i) => `<span class="${done[i] ? 'done' : i === done.indexOf(false) ? 'cur' : ''}"></span>`).join('')}</div>
      <ol class="g-steps" aria-label="Setup steps">${steps.map(([label, , , , , sic], i) => `<li><button data-act="guide" data-i="${i}" class="${done[i] ? 'done' : ''}${i === done.indexOf(false) ? ' now' : ''}${i === cur ? ' cur' : ''}" aria-current="${i === cur ? 'step' : 'false'}">
        <span class="gs-ico">${svg(done[i] ? 'check' : sic, 14, 2.4)}</span>
        <span class="gs-status">${done[i] ? 'Done' : i === done.indexOf(false) ? 'In progress' : 'To do'}</span>
        <span class="gs-label">${label}</span></button></li>`).join('')}</ol>
      <div class="g-panel">
        <span class="g-watermark" aria-hidden="true">${svg(ic, 104, 1.2)}</span>
        <div class="g-body">
          <p class="sp-kicker"><span class="g-dot ${done[cur] ? 'is-done' : ''}" aria-hidden="true"></span>Step ${cur + 1} · ${done[cur] ? 'Completed' : 'About ' + ['1', '2', '2', '3', '1'][cur] + ' min'}</p>
          <h3>${esc(title)}</h3><p class="g-desc">${esc(desc)}</p>
          <div class="g-actions"><s-button variant="${done[cur] ? 'secondary' : 'primary'}" data-go="${go}">${cta}</s-button>${cur < 4 ? `<s-button variant="tertiary" data-act="guide" data-i="${cur + 1}">Next step</s-button>` : ''}</div>
        </div>
        <div class="g-nav"><button data-act="guide" data-i="${Math.max(0, cur - 1)}" aria-label="Previous step"${cur === 0 ? ' disabled' : ''}>${svg('left', 16, 2.2)}</button><button data-act="guide" data-i="${Math.min(4, cur + 1)}" aria-label="Next step"${cur === 4 ? ' disabled' : ''}>${svg('right', 16, 2.2)}</button></div>
      </div>`}
    </div>
  </s-section>
  ${overview(sp, un)}
  </s-page>`;
};

// Dashboard "Overview": four at-a-glance cards. Label, one number, one short specific line. Nothing else.
function overview(sp, un) {
  const c = sf();
  const pct = sp.rows.length ? Math.round(((sp.rows.length - un) / sp.rows.length) * 100) : 0;
  const plural = (label, n) => { const l = label.toLowerCase(); return n === 1 || /(series|species)$/.test(l) ? l : (/(s|x|ch|sh)$/.test(l) ? l + 'es' : /[^aeiou]y$/.test(l) ? l.slice(0, -1) + 'ies' : l + 's'); };
  const coverage = sp.fields.filter((f) => f.type === 'list').slice(0, 3)
    .map((f) => { const n = new Set(sp.rows.map((r) => r.v[f.id]).filter(Boolean)).size; return n + ' ' + plural(f.label, n); }).join(' · ');

  const card = (label, value, badge, line, go) => `<button class="ov-card" data-go="${go}">
    <span class="ov-label">${label}</span>
    <span class="ov-value"><span class="metric-value">${value}</span>${badge}</span>
    <span class="ov-line">${esc(line)}</span>
  </button>`;

  return `<div class="ov-title"><h2>Overview</h2></div>
  <div class="ov">
    ${card('Search on your store', c.embed ? 'Live' : 'Off', c.embed ? '' : '<s-badge tone="critical">Hidden</s-badge>', '2 of 4 blocks added', 'store')}
    ${card('Filter rows', sp.rows.length, '', sp.rows.length ? coverage : 'No data yet', 'data')}
    ${card('Unlinked SKUs', un, un ? '<s-badge tone="warning">Needs linking</s-badge>' : '', `${pct}% of SKUs linked`, 'mapping')}
    ${card('Products without filter data', String((sp.looseProducts || []).filter((p) => !(sp.universal || []).some((u) => u.sku === p.sku)).length), '', 'Not shown in any search', 'mapping')}
  </div>`;
}
