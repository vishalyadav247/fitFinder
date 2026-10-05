// Screen: Storefront — app embed, theme blocks and live previews. Spec: .claude/specs/storefront.md
// Storefront settings live in state.sf; defaults are filled in on first use.
function sf() {
  const sp = setup(), t = tpl();
  state.sf = Object.assign({ tab: 'widget', device: 'desktop', layout: 'bar', btn: '#1D4ED8', bg: '#FFFFFF', corners: 'rounded', button: 'Show ' + (t.things || 'products'), garage: true, reset: true,
    embed: false, fitsText: 'Fits your ' + sp.noun, noFitText: "Doesn't fit your " + sp.noun,
    garageName: t.garage, maxSaved: '5', askSave: true, theme: 'live', themeSetup: {},
    text: '#1A1A1A', labels: false, showHeading: true, saveLink: true, saveText: 'Save to My Selection',
    tableStyle: 'collapsible', tableTitle: 'Fits these ' + sp.noun + 's', savedPos: 'right-middle', savedBg: '#FFFFFF', savedText: '#1A1A1A', savedIcon: tpl().icon, savedCount: true,
    askText: 'Select your ' + sp.noun + ' to check if it fits', badgeSel: true, noFitLink: true, noFitLinkText: 'See ' + (t.things || 'products') + ' that fit', tableOpen: true, tableRows: '5',
    tableLook: 'lines', tableHide: {}, tableSort: 'fields', tableEmpty: 'hide', tableEmptyText: 'Fits all ' + sp.noun + 's', tablePlace: 'block',
    resetText: 'Reset', noResults: 'No ' + (t.things || 'products') + ' fit this selection yet.', showAllText: 'Show all {n}', msSelected: 'Selected', msAdd: 'Add a ' + sp.noun,
    hintTitle: 'Shopping for', hintSub: '{n} saved · Click to switch or add', hintEmpty: 'Save your ' + sp.noun + ' here', hintEmptySub: 'Click to add your first ' + sp.noun }, state.sf || {});
  // Older prototype: Beauty used the noun "selection"; it is now "profile" (the shopper's brand / product type / gender).
  if (sp.type === 'beauty' && sp.noun === 'selection') {
    sp.noun = 'profile';
    const swap = [['your selection', 'your profile'], ['these selections', 'these profiles'], ['all selections', 'all profiles'], ['a selection', 'a profile'], ['your first selection', 'your first profile']];
    Object.keys(state.sf).forEach((k) => { if (typeof state.sf[k] === 'string') swap.forEach(([a, b]) => { state.sf[k] = state.sf[k].split(a).join(b); }); });
  }
  // Older prototype defaults said "parts" for every store type.
  if (t.things && t.things !== 'parts') { const w = t.things; if (state.sf.button === 'Show parts') state.sf.button = 'Show ' + w; if (state.sf.noFitLinkText === 'See parts that fit') state.sf.noFitLinkText = 'See ' + w + ' that fit'; if (state.sf.noResults === 'No parts fit this selection yet.') state.sf.noResults = 'No ' + w + ' fit this selection yet.'; }
  if (state.sf.tab === 'product') state.sf.tab = 'badge'; // the old Product page tab is now two tabs
  // Older prototype default colours for the My Selection button.
  if (state.sf.savedBg === '#1D4ED8' && state.sf.savedText === '#FFFFFF') { state.sf.savedBg = '#FFFFFF'; state.sf.savedText = '#1A1A1A'; }
  // Older prototype defaults for the shopper-facing name.
  if (['My Devices', 'Saved searches', 'Saved items', 'My Garage', 'My selections'].includes(state.sf.garageName)) state.sf.garageName = t.garage;
  return state.sf;
}
const RADIUS = { square: 2, rounded: 10, pill: 999 };

// The search widget as shoppers see it on the storefront (plain HTML, styled by the merchant's settings).
function sfWidget(sp, mobile) {
  const c = sf(), vertical = mobile || c.layout === 'card', r = RADIUS[c.corners];
  const sel = sp.fields.map((f, i) => {
    const ready = sp.fields.slice(0, i).every((p) => state.picks[p.id]);
    const opts = ready ? optionsFor(sp, i) : [];
    return `<label class="sfw-f"><span class="${c.labels ? 'sfw-l' : 'sr'}">${esc(f.label)}</span><select data-act="pick" data-field="${f.id}"${ready && opts.length ? '' : ' disabled'}>
      <option value="">${esc(placeholderFor(f))}</option>${opts.map((o) => `<option${state.picks[f.id] === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  }).join('');
  const all = sp.fields.length && sp.fields.every((f) => state.picks[f.id]);
  let results = '';
  if (state.searched && all) {
    const hits = sp.rows.filter((row) => rowMatches(sp, row, sp.fields.length) && row.mapped);
    results = `<div class="sfw-results">${hits.length ? hits.map((row) => `<div class="sfw-card"><span class="thumb"></span><div><b>${esc(row.part)}</b><span>✓ ${esc(c.fitsText)}</span></div><span class="sfw-price">[price]</span></div>`).join('') : '<p class="sfw-empty">${esc(c.noResults)}</p>'}</div>`;
  }
  return `<div class="sfw ${vertical ? 'v' : 'h'}" style="--b:${esc(c.btn)};--bg:${esc(c.bg)};--t:${esc(c.text)};--r:${Math.min(r, 14)}px;--rb:${r}px">
    ${c.showHeading ? `<p class="sfw-h">${esc(sp.heading)}</p>` : ''}
    <div class="sfw-row">${sel}<button class="sfw-go" data-act="search"${all ? '' : ' disabled'}>${esc(c.button)}</button></div>
    ${c.saveLink || c.reset ? `<div class="sfw-links">${c.saveLink ? `<span>☆ ${esc(c.saveText)}</span>` : ''}${c.reset ? `<button data-act="clear-picks">${esc(c.resetText)}</button>` : ''}</div>` : ''}
    ${results}</div>`;
}

// Previews show only FitFinder's part (no browser or store frame). Mobile narrows it to phone width.
const browser = (inner, mobile) => `<div class="pv-stage ${mobile ? 'mobile' : ''}">${inner}</div>`;

// The store's themes (real app: GraphQL `themes` query). The live theme is what shoppers see.
const THEMES = [
  { id: 'live', name: 'Dawn', role: 'Live theme' },
  { id: 'draft-1', name: 'Dawn – holiday sale', role: 'Draft' },
  { id: 'draft-2', name: 'Refresh', role: 'Draft' }
];
// App embed and block status for the selected theme. The live theme keeps its embed in sf().embed (used by the dashboard).
function themeSetup(c) {
  const live = c.theme === 'live', own = (c.themeSetup || {})[c.theme] || {};
  return { live, embed: live ? !!c.embed : !!own.embed, blocks: live ? { search: true } : own.blocks || {} };
}

// Short name for a shopper's selection: first and last dropdown values, e.g. "AUDI A6 C6 Avant (4F5)" or "Apple iPhone 15 Pro".
function selectionName(sp, row) {
  const lists = sp.fields.filter((f) => f.type !== 'years').map((f) => row.v[f.id]).filter(Boolean);
  return lists.length > 1 ? lists[0] + ' ' + lists[lists.length - 1] : lists.join(' ');
}

S.store = () => {
  const sp = setup(), t = tpl(), c = sf(), mobile = c.device === 'mobile';
  const first = sp.rows.find((row) => row.mapped) || sp.rows[0];
  const vehicle = first ? selectionName(sp, first) : '';
  const th = themeSetup(c), theme = THEMES.find((x) => x.id === c.theme) || THEMES[0];
  const blocks = [['Search section', 'Home page', th.blocks.search], ['Fits badge', 'Product page', th.blocks.badge], ['Fitment table', 'Product page', th.blocks.table]];

  // Theme setup: theme + app embed in one row, then a table of the blocks with their type, placement and status.
  const items = [
    // Type is the Shopify theme type: a section the merchant places on a page, an app block inside an existing section,
    // or part of the app embed (no placing needed: it shows on every page when the embed and the feature are on).
    ['Search section', 'Section', 'Home, collection, product or any other page', blocks[0][2]],
    ['Fits badge', 'App block', 'Product page, inside the product info', blocks[1][2]],
    c.tablePlace === 'tabs'
      ? ['Fitment table', 'Code in a theme tab', 'Product page, inside your theme\'s tabs', blocks[2][2], 'code']
      : ['Fitment table', 'App block', 'Product page, with the description and specification tabs', blocks[2][2]],
    ['My Selection', 'App embed', 'Floating button on every page', th.embed && c.garage, 'embed']
  ];
  const setupCard = `<s-section padding="none" accessibilityLabel="Theme integration">
    <s-box padding="base" paddingBlockEnd="none"><h2 class="sec-title">Theme integration</h2></s-box>
    <s-box padding="base"><s-grid gridTemplateColumns="minmax(0, 320px) 1fr auto" gap="large" alignItems="end">
      <s-select label="Theme" data-act="sf" data-key="theme" value="${esc(c.theme)}">${THEMES.map((x) => `<s-option value="${x.id}">${esc(x.name)} (${x.role.toLowerCase()})</s-option>`).join('')}</s-select>
      <s-box></s-box>
      <s-stack direction="inline" gap="small-300" alignItems="center" justifyContent="end" paddingBlockEnd="small-300"><s-text type="strong">App embed</s-text><s-badge tone="${th.embed ? 'success' : 'critical'}">${th.embed ? 'On' : 'Off'}</s-badge><s-switch label="App embed" labelAccessibilityVisibility="exclusive" accessibilityLabel="Turn the app embed on or off in the theme editor" data-act="sf-embed"${th.embed ? ' checked' : ''}></s-switch></s-stack>
    </s-grid></s-box>
    ${th.live ? '' : `<s-box paddingInline="base" paddingBlockEnd="base"><s-banner tone="info" heading="${esc(theme.name)} isn't your live theme">You can set FitFinder up here now. Shoppers see it once you publish this theme.</s-banner></s-box>`}
    <s-table>
      <s-table-header-row><s-table-header listSlot="primary">Feature</s-table-header><s-table-header>Type</s-table-header><s-table-header>Placement</s-table-header><s-table-header>Status</s-table-header><s-table-header>Action</s-table-header></s-table-header-row>
      <s-table-body>${items.map(([name, type, where, on, kind]) => `<s-table-row>
        <s-table-cell><s-text type="strong">${name}</s-text></s-table-cell>
        <s-table-cell>${type}</s-table-cell>
        <s-table-cell><s-text color="subdued">${where}</s-text></s-table-cell>
        <s-table-cell>${kind === 'code' ? (on ? '<s-badge tone="success">Code found</s-badge>' : '<s-badge>Code not found yet</s-badge>') : kind === 'embed' ? (on ? '<s-badge tone="success">Showing</s-badge>' : `<s-badge>${th.embed ? 'Turned off' : 'Needs app embed'}</s-badge>`) : on ? '<s-badge tone="success">Added</s-badge>' : '<s-badge>Not added</s-badge>'}</s-table-cell>
        <s-table-cell>${kind === 'code' ? '<s-button variant="tertiary" icon="settings" data-act="sf-set" data-key="tab" data-val="table">How to add</s-button>' : kind === 'embed' ? `<s-stack direction="inline" gap="small-200" alignItems="center"><s-switch label="Show My Selection" labelAccessibilityVisibility="exclusive" data-act="sf-bool" data-key="garage"${c.garage ? ' checked' : ''}${th.embed ? '' : ' disabled'}></s-switch><s-button variant="tertiary" icon="settings" data-act="sf-set" data-key="tab" data-val="garage">Settings</s-button></s-stack>` : on ? `<s-button variant="tertiary" icon="external" accessibilityLabel="Show ${name} in the theme editor">View in editor</s-button>`
          : `<s-button icon="plus"${th.embed ? '' : ' disabled'} accessibilityLabel="Add ${name} to the theme in the theme editor">Add to theme</s-button>`}</s-table-cell>
      </s-table-row>`).join('')}</s-table-body>
    </s-table>
  </s-section>`;

  const tabs = `<div class="tabs" role="tablist" aria-label="Storefront">${[['widget', 'Search widget'], ['badge', 'Fits badge'], ['table', 'Fitment table'], ['garage', 'My Selection']].map(([k, l]) =>
    `<button role="tab" aria-selected="${c.tab === k}" data-act="sf-set" data-key="tab" data-val="${k}">${l}</button>`).join('')}</div>`;

  // Preview header: title + Desktop / Mobile as icon buttons (the selected one is the secondary button, the other tertiary).
  const device = (val, icon, label) => `<s-button icon="${icon}" variant="${c.device === val ? 'secondary' : 'tertiary'}" accessibilityLabel="${label} preview" data-act="sf-set" data-key="device" data-val="${val}"></s-button>`;
  const previewHead = (title, live) => `<div class="pv-head">${live ? `<s-badge tone="success" icon="view">${title}</s-badge>` : `<s-text type="strong">${title}</s-text>`}<s-stack direction="inline" gap="small-300">${device('desktop', 'desktop', 'Desktop')}${device('mobile', 'mobile', 'Mobile')}</s-stack></div>`;

  let body = '';
  if (c.tab === 'widget') {
    const sel = (key, label, opts, details) => `<s-select label="${label}"${details ? ` details="${details}"` : ''} data-act="sf" data-key="${key}" value="${esc(c[key])}">${opts.map(([v, l]) => `<s-option value="${v}">${l}</s-option>`).join('')}</s-select>`;
    body = `<s-section>${previewHead('Live preview', true)}${browser(sfWidget(sp, mobile), mobile)}</s-section>
    <s-section accessibilityLabel="Layout and style"><h2 class="sec-title sec-gap">Layout and style</h2>
      <div class="opt-grid">
        ${sel('layout', 'Layout', [['bar', 'Horizontal (one row)'], ['card', 'Vertical (stacked)']], 'On phones the dropdowns always stack.')}
        ${sel('corners', 'Corners', [['square', 'Square'], ['rounded', 'Rounded'], ['pill', 'Pill']])}
      </div>
      <s-box paddingBlockStart="base"><div class="opt-grid three">
        <s-color-field label="Button colour" data-act="sf" data-key="btn" value="${esc(c.btn)}"></s-color-field>
        <s-color-field label="Background" data-act="sf" data-key="bg" value="${esc(c.bg)}"></s-color-field>
        <s-color-field label="Text colour" data-act="sf" data-key="text" value="${esc(c.text)}"></s-color-field>
      </div></s-box>
      <s-box paddingBlockStart="base"><s-checkbox label="Show labels above the dropdowns" details="Off: the field name is shown inside each dropdown instead." data-act="sf-bool" data-key="labels"${c.labels ? ' checked' : ''}></s-checkbox></s-box>
    </s-section>
    <s-grid gridTemplateColumns="minmax(0, 2fr) minmax(0, 1fr)" gap="base" alignItems="start">
    <s-section accessibilityLabel="Text"><h2 class="sec-title sec-gap">Text</h2>
      <s-stack gap="base">
        <s-stack gap="small-200">
          <s-text-field label="Search heading" data-act="heading" value="${esc(sp.heading)}"></s-text-field>
          <s-checkbox label="Show search heading" data-act="sf-bool" data-key="showHeading"${c.showHeading ? ' checked' : ''}></s-checkbox>
        </s-stack>
        <s-text-field label="Button text" data-act="sf" data-key="button" value="${esc(c.button)}"></s-text-field>
        <s-text-field label="Save link text" data-act="sf" data-key="saveText" value="${esc(c.saveText)}"></s-text-field>
        <s-box><s-text color="subdued">Dropdowns and their placeholder text come from your search fields: </s-text>${chips(sp.fields.map((f) => f.label))} <s-link data-go="fields">Edit fields</s-link></s-box>
      </s-stack>
    </s-section>
    <s-section accessibilityLabel="Behaviour"><h2 class="sec-title sec-gap">Behaviour</h2>
      <s-stack gap="small">
        <s-checkbox label="Show “${esc(c.saveText)}”" data-act="sf-bool" data-key="saveLink"${c.saveLink ? ' checked' : ''}></s-checkbox>
        <s-checkbox label="Show a reset link" data-act="sf-bool" data-key="reset"${c.reset ? ' checked' : ''}></s-checkbox>
      </s-stack>
    </s-section>
    </s-grid>`;
  } else if (c.tab === 'badge' || c.tab === 'table') {
    // Fits badge tab and Fitment table tab: settings on the left, their own preview on the right.
    const sel = c.badgeSel && vehicle ? `<small>${esc(vehicle)}</small>` : '';
    const badges = `<p class="pv-cap">Before a selection</p><div class="fit ask">${esc(c.askText)}</div>
      <p class="pv-cap">When it fits</p><div class="fit ok">✓ ${esc(c.fitsText)}${sel}</div>
      <p class="pv-cap">When it doesn't fit</p><div class="fit no">✕ ${esc(c.noFitText)}${sel}${c.noFitLink ? `<small class="fit-link">${esc(c.noFitLinkText)} →</small>` : ''}</div>`;
    // Fitment table preview: sample rows (a real product usually fits several), with the chosen columns, sorting, limit and look.
    const cols = sp.fields.filter((fl) => !(c.tableHide || {})[fl.id]);
    const yf = sp.fields.find((fl) => fl.type === 'years');
    const sample = sp.rows.slice(0, 7).sort((x, y) => c.tableSort === 'year' && yf
      ? Math.max(...years(y.v[yf.id])) - Math.max(...years(x.v[yf.id]))
      : sp.fields.map((fl) => String(x.v[fl.id] || '')).join('|').localeCompare(sp.fields.map((fl) => String(y.v[fl.id] || '')).join('|')));
    const limit = c.tableRows === 'all' ? Infinity : +c.tableRows;
    const tableHtml = `<table class="ft-${c.tableLook}"><tr>${cols.map((fl) => `<th>${esc(fl.label)}</th>`).join('')}</tr>${sample.slice(0, limit).map((row) => `<tr>${cols.map((fl) => `<td>${esc(showValue(fl, row.v[fl.id]))}</td>`).join('')}</tr>`).join('')}</table>${sample.length > limit ? `<p class="fit-more">${esc(c.showAllText.split('{n}').join(sample.length))}</p>` : ''}`;
    const open = c.tableStyle === 'open' || c.tableOpen;
    const wrap = (inner, opened) => c.tableStyle === 'open'
      ? `<div class="fit-open"><b>${esc(c.tableTitle)}</b>${inner}</div>`
      : `<div class="acc-row ${opened ? 'open' : ''}"><div class="acc-h"><span>${esc(c.tableTitle)}</span><i>${opened ? '⌃' : '⌄'}</i></div>${opened ? inner : ''}</div>`;
    const inTabs = c.tablePlace === 'tabs';
    const tabBar = (inner) => `<div class="th-tabs"><div class="th-bar"><span>Description</span><span>Specifications</span><span class="on">Fits these ${esc(sp.noun)}s</span><span>Reviews</span></div><div class="th-body">${inner}</div></div>`;
    const fitRow = !sample.length ? '' : inTabs ? tabBar(tableHtml) : wrap(tableHtml, open);
    const emptyRow = c.tableEmpty === 'text' ? (inTabs ? tabBar(`<p class="ft-empty">${esc(c.tableEmptyText)}</p>`) : wrap(`<p class="ft-empty">${esc(c.tableEmptyText)}</p>`, true)) : `<p class="ft-hidden">${inTabs ? 'The code shows nothing (the tab stays empty)' : 'Nothing is shown'}</p>`;
    const pv = (note, inner) => `<s-section><div class="pv-head"><s-badge tone="success" icon="view">Live preview</s-badge><s-text color="subdued">${note}</s-text></div>${browser(`<div class="pdp-parts">${inner}</div>`, false)}</s-section>`;
    if (c.tab === 'badge') body = `
    <s-grid gridTemplateColumns="minmax(0, 1fr) minmax(0, 1fr)" gap="base" alignItems="start">
    <s-section accessibilityLabel="Fits badge"><h2 class="sec-title sec-gap">Fits badge</h2>
      <s-box paddingBlockEnd="base"><s-paragraph color="subdued">Tells shoppers on the product page whether it fits what they picked. Place it in the theme editor, usually above Add to cart.</s-paragraph></s-box>
      <s-stack gap="base">
        <s-stack gap="small-300"><p class="grp-t">Before a selection</p>
          <s-text-field label="Text" data-act="sf" data-key="askText" value="${esc(c.askText)}"></s-text-field>
        </s-stack>
        <s-divider></s-divider>
        <s-stack gap="small-300"><p class="grp-t">When it fits</p>
          <s-text-field label="Text" data-act="sf" data-key="fitsText" value="${esc(c.fitsText)}"></s-text-field>
        </s-stack>
        <s-divider></s-divider>
        <s-stack gap="small-300"><p class="grp-t">When it doesn't fit</p>
          <s-text-field label="Text" data-act="sf" data-key="noFitText" value="${esc(c.noFitText)}"></s-text-field>
          <s-checkbox label="Show a link to ${esc(t.things || 'products')} that fit" data-act="sf-bool" data-key="noFitLink"${c.noFitLink ? ' checked' : ''}></s-checkbox>
          ${c.noFitLink ? `<s-text-field label="Link text" data-act="sf" data-key="noFitLinkText" value="${esc(c.noFitLinkText)}"></s-text-field>` : ''}
        </s-stack>
        <s-divider></s-divider>
        <s-checkbox label="Show the shopper's selection under the text" details="${vehicle ? `For example ${esc(vehicle)}. ` : ''}Shown when it fits and when it doesn't." data-act="sf-bool" data-key="badgeSel"${c.badgeSel ? ' checked' : ''}></s-checkbox>
      </s-stack>
    </s-section>
    ${pv('All three states, as shoppers see them.', badges)}
    </s-grid>`;
    if (c.tab === 'table') body = `
    <s-grid gridTemplateColumns="minmax(0, 1fr) minmax(0, 1fr)" gap="base" alignItems="start">
    <s-section accessibilityLabel="Fitment table"><h2 class="sec-title sec-gap">Fitment table</h2>
      <s-box paddingBlockEnd="base"><s-paragraph color="subdued">Lists everything this product fits.</s-paragraph></s-box>
      <s-stack gap="base">
        <s-stack gap="small-300"><p class="grp-t">Where to show it</p>
          <s-select label="Show the table" labelAccessibilityVisibility="exclusive" data-act="sf" data-key="tablePlace" value="${esc(c.tablePlace)}"><s-option value="block">As its own block</s-option><s-option value="tabs">Inside your theme's tabs (Description, Specifications …)</s-option></s-select>
          ${inTabs ? `<s-box padding="base" background="subdued" borderRadius="base"><s-stack gap="small-300">
            <s-text type="strong">Add it to your product tabs in 3 steps</s-text>
            <ol class="steps-ol">
              <li>In the theme editor, open a product page and select your tabs section (the one with Description, Specifications …).</li>
              <li>Add a tab, name it for example “Fits these ${esc(sp.noun)}s”, and paste this code as its content:
                <span class="code-row"><code>[fitfinder-table]</code><s-button variant="tertiary" icon="clipboard" data-act="copy-code" data-code="[fitfinder-table]">Copy</s-button></span></li>
              <li>Save. FitFinder replaces the code with the table on every product page. Your theme decides how the tabs look: tabs on desktop, often an accordion on phones.</li>
            </ol>
            <s-text color="subdued">Needs the app embed (Theme integration). Products with no rows follow “When a product has no rows” below.</s-text>
            <s-stack direction="inline"><s-button icon="external">Open theme editor</s-button></s-stack>
          </s-stack></s-box>` : `<s-text color="subdued">Sits with your product page's description and specification rows: drag it between them in the theme editor.</s-text>`}
        </s-stack>
        <s-divider></s-divider>
        <s-stack gap="small-300"><p class="grp-t">Display</p>
          ${inTabs ? '' : `<s-select label="Show as" data-act="sf" data-key="tableStyle" value="${esc(c.tableStyle)}"><s-option value="collapsible">Collapsible row (matches your theme's tabs)</s-option><s-option value="open">Open table</s-option></s-select>
          <s-text-field label="Title" data-act="sf" data-key="tableTitle" value="${esc(c.tableTitle)}"></s-text-field>
          ${c.tableStyle === 'collapsible' ? `<s-checkbox label="Start expanded" data-act="sf-bool" data-key="tableOpen"${c.tableOpen ? ' checked' : ''}></s-checkbox>` : ''}`}
          <s-select label="Table style" data-act="sf" data-key="tableLook" value="${esc(c.tableLook)}"><s-option value="lines">Lines between rows</s-option><s-option value="striped">Striped rows</s-option><s-option value="plain">Plain</s-option></s-select>
          ${inTabs ? '<s-text color="subdued">The tab\'s name comes from your theme.</s-text>' : ''}
        </s-stack>
        <s-divider></s-divider>
        <s-stack gap="small-300"><p class="grp-t">Columns</p>
          <s-text color="subdued">One column per search field, in the same order as Search setup.</s-text>
          ${sp.fields.map((fl) => `<s-checkbox label="${esc(fl.label)}" data-act="sf-col" data-field="${fl.id}"${(c.tableHide || {})[fl.id] ? '' : ' checked'}${cols.length === 1 && !(c.tableHide || {})[fl.id] ? ' disabled' : ''}></s-checkbox>`).join('')}
        </s-stack>
        <s-divider></s-divider>
        <s-stack gap="small-300"><p class="grp-t">Rows</p>
          <s-select label="Sort by" data-act="sf" data-key="tableSort" value="${esc(c.tableSort)}"><s-option value="fields">Search field order (A–Z)</s-option>${yf ? `<s-option value="year">Newest ${esc(yf.label.toLowerCase())} first</s-option>` : ''}</s-select>
          <s-select label="Rows before “Show all”" data-act="sf" data-key="tableRows" value="${esc(c.tableRows)}"><s-option value="5">5</s-option><s-option value="10">10</s-option><s-option value="all">All</s-option></s-select>
        </s-stack>
        <s-divider></s-divider>
        <s-stack gap="small-300"><p class="grp-t">When a product has no rows</p>
          <s-select label="Show" labelAccessibilityVisibility="exclusive" data-act="sf" data-key="tableEmpty" value="${esc(c.tableEmpty)}"><s-option value="hide">Hide the table</s-option><s-option value="text">Show a text instead</s-option></s-select>
          ${c.tableEmpty === 'text' ? `<s-text-field label="Text" details="Useful for universal products." data-act="sf" data-key="tableEmptyText" value="${esc(c.tableEmptyText)}"></s-text-field>` : ''}
        </s-stack>
      </s-stack>
    </s-section>
    ${pv(inTabs ? 'Inside your theme\'s tabs, with sample rows. On phones your theme may show them as an accordion.' : 'With sample rows.', `<p class="pv-cap">Product with rows</p>${fitRow}<p class="pv-cap">Product with no rows</p>${emptyRow}`)}
    </s-grid>`;
  } else {
    // My Selection: the tab shows the current selection; hover shows a hint card;
    // click opens a panel that slides in. Side positions use a vertical tab stuck to the window edge.
    const yearF = sp.fields.find((x) => x.type === 'years'), lists = sp.fields.filter((x) => x.type !== 'years');
    const savedRows = sp.rows.filter((row) => row.mapped).slice(0, 2).map((row) => ({
      top: [yearF ? Math.min(...years(row.v[yearF.id])) : '', lists[0] ? row.v[lists[0].id] : ''].filter(Boolean).join(' '),
      sub: lists.length > 1 ? row.v[lists[lists.length - 1].id] : '' }));
    const pos = c.savedPos, side = pos === 'right-middle' || pos === 'left-middle';
    const icon = c.savedIcon === 'none' ? '' : c.savedIcon === 'custom' ? (c.savedIconUrl ? `<img class="g-icon" src="${esc(c.savedIconUrl)}" alt="">` : '') : svg(c.savedIcon, 24, 1.9);
    const current = savedRows[0] ? (savedRows[0].top + ' ' + savedRows[0].sub).trim() : c.garageName;
    const panel = `<div class="ms-panel">
        <button class="ms-handle" data-act="ms-state" data-val="closed" aria-label="Close">${svg(pos === 'left-middle' ? 'left' : pos === 'right-middle' ? 'right' : 'down', 18, 2.2)}</button>
        <p class="ms-title">${esc(c.garageName)}</p>
        ${savedRows.map((r, i) => `<div class="ms-item ${i === 0 ? 'on' : ''}">${i === 0 ? '<span class="ms-pill">${esc(c.msSelected)}</span>' : ''}<div><b>${esc(r.top)}</b><small>${esc(r.sub)}</small></div>${svg('trash', 18, 1.7)}</div>`).join('')}
        <div class="ms-add" style="background:${esc(c.savedText)};color:#FFFFFF">${esc(c.msAdd)}</div>
      </div>`;
    const floating = c.garage ? `<div class="ms ms-${pos}" style="--ms-bg:${esc(c.savedBg)};--ms-fg:${esc(c.savedText)}">
        <button class="ms-tab" data-act="ms-state" data-val="open" title="${esc(current)}">${icon}<span>${esc(current)}</span>${c.savedCount && savedRows.length ? `<em class="ms-count">${savedRows.length}</em>` : ''}</button>
        <div class="ms-hint" aria-hidden="true"><b>${savedRows.length ? esc(c.hintTitle) : esc(c.garageName)}</b><span>${savedRows.length ? esc(current) : esc(c.hintEmpty)}</span><small>${savedRows.length ? esc(c.hintSub.split('{n}').join(savedRows.length)) : esc(c.hintEmptySub)}</small></div>${panel}</div>` : '';
    // Settings on the left, preview on the right.
    body = `<s-grid gridTemplateColumns="minmax(0, 1fr) minmax(0, 1fr)" gap="base" alignItems="start">
    <s-section accessibilityLabel="My Selection"><h2 class="sec-title sec-gap">My Selection</h2>
      <s-box paddingBlockEnd="base"><s-paragraph color="subdued">A floating button that stays in a corner of every page. Shoppers save what they searched for and pick it again on their next visit. It's part of the app embed, so there's nothing to place in the theme.</s-paragraph></s-box>
      ${th.embed ? '' : '<s-box paddingBlockEnd="base"><s-banner tone="warning" heading="Turn on the app embed to show the button">The button is part of the app embed in Theme integration.</s-banner></s-box>'}
      ${th.embed && !c.garage ? '<s-box paddingBlockEnd="base"><s-banner tone="info" heading="My Selection is turned off">Turn it on with its switch in Theme integration above. You can still set it up here.</s-banner></s-box>' : ''}
      <s-box paddingBlockStart="base"><div class="opt-grid one">
        <s-text-field label="Name shoppers see" details="For example My Selection, My Garage or My Devices." data-act="sf" data-key="garageName" value="${esc(c.garageName)}"></s-text-field>
        <s-select label="Position" data-act="sf" data-key="savedPos" value="${esc(c.savedPos)}"><s-option value="right-middle">Right edge, middle (vertical tab)</s-option><s-option value="left-middle">Left edge, middle (vertical tab)</s-option><s-option value="bottom-right">Bottom right</s-option><s-option value="bottom-left">Bottom left</s-option></s-select>
        <s-select label="Icon" data-act="sf" data-key="savedIcon" value="${esc(c.savedIcon)}"><s-option value="star">Star</s-option><s-option value="heart">Heart</s-option><s-option value="bookmark">Bookmark</s-option><s-option value="clock">Clock (recent)</s-option><s-option value="${tpl().icon}">${esc(tpl().noun.charAt(0).toUpperCase() + tpl().noun.slice(1))}</s-option><s-option value="custom">Custom (upload your own)</s-option><s-option value="none">No icon</s-option></s-select>
        ${c.savedIcon === 'custom' ? `<s-stack gap="small-200"><s-drop-zone label="Upload an icon" accept=".svg,.png,image/svg+xml,image/png" data-act="sf-icon-upload"></s-drop-zone><s-text color="subdued">SVG or PNG, square, at least 48 × 48 px, up to 100 KB. Shown at 24 px next to the name.</s-text></s-stack>${c.savedIconUrl ? '<s-stack direction="inline" gap="small-200" alignItems="center"><s-text color="subdued">Icon uploaded.</s-text><s-button variant="tertiary" data-act="sf-set" data-key="savedIconUrl" data-val="">Remove</s-button></s-stack>' : ''}` : ''}
        <s-grid gridTemplateColumns="1fr 1fr" gap="base"><s-color-field label="Background colour" data-act="sf" data-key="savedBg" value="${esc(c.savedBg)}"></s-color-field><s-color-field label="Text colour" data-act="sf" data-key="savedText" value="${esc(c.savedText)}"></s-color-field></s-grid>
        <s-select label="Saved selections per shopper" data-act="sf" data-key="maxSaved" value="${esc(c.maxSaved)}"><s-option value="3">3</s-option><s-option value="5">5</s-option><s-option value="10">10</s-option></s-select>
        <s-checkbox label="Show saved selection count" data-act="sf-bool" data-key="savedCount"${c.savedCount ? ' checked' : ''}></s-checkbox>
      </div></s-box>
      <s-box paddingBlockStart="base"><s-checkbox label="Ask shoppers to save their selection after a search" data-act="sf-bool" data-key="askSave"${c.askSave ? ' checked' : ''}></s-checkbox></s-box>
    </s-section>
    <s-section><div class="pv-head"><s-badge tone="success" icon="view">Live preview</s-badge><s-text color="subdued">Hover the tab or click it to try it. Looks the same on desktop and mobile.</s-text></div>
      <div class="mini-win"><div class="mw-bar"><i></i><i></i><i></i><em>your-store.com</em></div><div class="mw-body">${floating}</div></div></s-section>
    </s-grid>`;
  }

  return `<s-page heading="Storefront" inlineSize="base">
  <s-button slot="primary-action" variant="primary" icon="external">Open theme editor</s-button>
  <s-stack gap="base">${setupCard}${tabs}${body}</s-stack></s-page>`;
};
