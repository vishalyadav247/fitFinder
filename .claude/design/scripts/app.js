// Rendering and event handling for the whole prototype. Loaded last.
/* ---------- render + events ---------- */
function onChange(e) {
  const el = e.currentTarget, a = el.dataset.act;
  if (!state.setup) return;
  const sp = setup();
  if (a === 'pick') {
    const i = sp.fields.findIndex((x) => x.id === el.dataset.field);
    state.picks[el.dataset.field] = el.value;
    sp.fields.slice(i + 1).forEach((x) => { delete state.picks[x.id]; });
    state.searched = false;
  } else if (a === 'field-ph') { const f = sp.fields.find((x) => x.id === el.dataset.field); if (f) f.placeholder = String(el.value).trim(); }
  else if (a === 'field-label') { const f = sp.fields.find((x) => x.id === el.dataset.field); if (f) f.label = String(el.value).trim() || f.label; }
  else if (a === 'field-req') { const f = sp.fields.find((x) => x.id === el.dataset.field); if (f) f.required = !!el.checked; return save(); }
  else if (a === 'field-type') {
    const f = sp.fields.find((x) => x.id === el.dataset.field); if (!f) return;
    // Keep the saved mapping sensible: one column becomes a from–to range column and back.
    (sp.cols || []).forEach((c) => { if (el.value === 'years' && c.use === f.id) c.use = f.id + ':range'; if (el.value === 'list' && c.use.startsWith(f.id + ':')) c.use = c.use === f.id + ':to' ? 'skip' : f.id; });
    f.type = el.value; state.picks = {};
  }
  else if (a === 'heading') { sp.heading = String(el.value).trim() || sp.heading; }
  else if (a === 'mode') { state.mode = (el.values && el.values[0]) || state.mode; return save(); }
  else if (a === 'sf') { sf()[el.dataset.key] = String(el.value ?? ''); }
  else if (a === 'sf-icon-upload') { // prototype: keep the image as a data URL; the real app uploads it to Shopify Files
    const file = el.files && el.files[0]; if (!file) return;
    if (file.size > 100 * 1024) { el.error = 'The file is larger than 100 KB'; return; }
    const reader = new FileReader(); reader.onload = () => { sf().savedIconUrl = String(reader.result); render(); }; reader.readAsDataURL(file); return;
  }
  else if (a === 'sf-col') { const c = sf(); c.tableHide = Object.assign({}, c.tableHide, { [el.dataset.field]: !el.checked }); }
  else if (a === 'sf-bool') { sf()[el.dataset.key] = !!el.checked; }
  else if (a === 'sf-embed') {
    // Apps can't switch the embed themselves: the real app opens the theme editor's App embeds panel for the selected theme,
    // and re-reads the status when the merchant comes back. The prototype simulates the merchant saving it there.
    const c = sf(), on = !!el.checked;
    if (c.theme === 'live') c.embed = on; else { c.themeSetup = c.themeSetup || {}; c.themeSetup[c.theme] = Object.assign({}, c.themeSetup[c.theme], { embed: on }); }
    state.flash = 'Theme editor opened. App embed turned ' + (on ? 'on' : 'off') + ' (simulated)';
  }
  else if (a === 'export-scope') { state.exportScope = (el.values && el.values[0]) || 'all'; return save(); }
  else if (a === 'map-col') { mapColumn(el.dataset.col, el.value); return; }
  else if (a === 'map-skus') { state.mapNoSkus = !el.checked; return save(); }
  else if (a === 'map-titles') { state.mapNoTitles = !el.checked; const g = document.querySelector('.map-grid'); if (g) g.classList.toggle('no-titles', state.mapNoTitles); return save(); }
  else if (a === 'sel') { const id = el.dataset.id; state.sel = (state.sel || []).filter((x) => x !== id).concat(el.checked ? [id] : []); state.exportScope = null; }
  else return;
  render();
}
function render() {
  if (!state.setup) state.screen = 'onboarding';
  renderNav();
  const view = document.getElementById('view');
  view.innerHTML = (S[state.screen] || S.home)() + confirmModal();
  view.querySelectorAll('s-select[data-act], s-drop-zone[data-act], s-text-field[data-act], s-email-field[data-act], s-switch[data-act], s-choice-list[data-act], s-checkbox[data-act], s-color-field[data-act], select[data-act]').forEach((el) => el.addEventListener('change', onChange));
  view.querySelectorAll('s-search-field[data-act="q"]').forEach((el) => el.addEventListener('input', () => {
    const q = String(el.value || '').toLowerCase().trim(); let shown = 0;
    view.querySelectorAll('s-table-row[data-row-text]').forEach((row) => { const hit = !q || row.dataset.rowText.includes(q); row.hidden = !hit; if (hit) shown++; });
    const c = view.querySelector('#row-count'); if (c) c.textContent = q ? shown + ' of ' + setup().rows.length + ' rows match' : setup().rows.length + ' rows';
  }));
  // s-select doesn't read a value attribute that's set before its options exist, so set it as a property.
  customElements.whenDefined('s-select').then(() => requestAnimationFrame(() =>
    view.querySelectorAll('s-select[value]').forEach((el) => { const v = el.getAttribute('value'); if (v) el.value = v; })));
  // Same for s-choice-list: copy each pre-selected s-choice into the list's values.
  customElements.whenDefined('s-choice-list').then(() => requestAnimationFrame(() =>
    view.querySelectorAll('s-choice-list').forEach((el) => { el.values = [...el.querySelectorAll('s-choice[selected]')].map((c) => c.getAttribute('value')); })));
  if (state.flash) { const msg = state.flash; state.flash = ''; showToast(msg); }
  if (state.scrollToImport) { state.scrollToImport = false; requestAnimationFrame(() => { const c = document.getElementById('import-card'); if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }); }
  // Open a modal after the page is drawn (render() replaces the page, which closes any open modal).
  if (state.openModal) { const id = state.openModal; state.openModal = null; customElements.whenDefined('s-modal').then(() => requestAnimationFrame(() => { const m = document.getElementById(id); if (m && m.showOverlay) m.showOverlay(); })); }
  save();
}
// Finishes an import: saves the mapping for next time and adds the file to the import history (last 5).
function finishImport(sp) {
  const d = state.mapDraft || {};
  (sp.cols || []).forEach((c) => { if (d[c.id]) c.use = d[c.id]; });
  // Year range fields: one column holds ranges like 2015-2020; with two, the left one is from and the right one is to.
  sp.fields.filter((f) => f.type === 'years').forEach((f) => { const yc = (sp.cols || []).filter((c) => c.use === f.id); if (yc.length === 1) yc[0].use = f.id + ':range'; if (yc.length === 2) { yc[0].use = f.id + ':from'; yc[1].use = f.id + ':to'; } });
  sp.history = [{ file: 'new-filter-data.csv', when: 'Just now', mode: { upsert: 'Add and update', replace: 'Replace all', remove: 'Delete listed rows' }[state.mode], rows: '[rows]' }].concat(sp.history || []).slice(0, 5); // keep the last 5 files
  state.mapDraft = null; state.importStep = 0;
  state.flash = state.mode === 'remove' ? 'Rows deleted' : 'Import finished';
}
// Runs a destructive action after the merchant confirmed it in the confirmation modal.
function runConfirmed(c) {
  if (c.kind === 'reset') { state = freshState(); return; }
  const sp = setup(); if (!sp) return;
  if (c.kind === 'import-remove' || c.kind === 'import-replace') finishImport(sp);
  if (c.kind === 'row-del') { const r = sp.rows.find((x) => x.id === c.id); sp.rows = sp.rows.filter((x) => x.id !== c.id); state.sel = (state.sel || []).filter((x) => x !== c.id); if (state.editing === c.id) state.editing = null; state.flash = 'Row deleted'; }
  if (c.kind === 'sel-delete') { const ids = state.sel || []; sp.rows = sp.rows.filter((r) => !ids.includes(r.id)); state.sel = []; state.flash = ids.length + ' row' + (ids.length === 1 ? '' : 's') + ' deleted'; }
  if (c.kind === 'dedupe') { const dupes = duplicateRows(sp); sp.rows = sp.rows.filter((r) => !dupes.includes(r)); state.flash = dupes.length + ' duplicate row' + (dupes.length === 1 ? '' : 's') + ' removed'; }
  if (c.kind === 'wipe') { sp.rows = []; state.sel = []; state.flash = 'All filter rows deleted'; }
  if (c.kind === 'field-del') { const i = sp.fields.findIndex((x) => x.id === c.field); if (i >= 0) sp.fields.splice(i, 1); (sp.cols || []).forEach((col) => { if (col.use === c.field || col.use.startsWith(c.field + ':')) col.use = 'skip'; }); state.picks = {}; state.searched = false; state.flash = 'Field deleted'; }
}
// Mapping modal: a target (field, year from/to/range, SKU) belongs to one column, so picking it clears it elsewhere.
// A Year range field may take two columns (from and to); every other target takes one.
function mapColumn(colId, use) {
  const d = state.mapDraft || (state.mapDraft = {});
  const f = setup().fields.find((x) => x.id === use), max = f && f.type === 'years' ? 2 : 1;
  const others = Object.keys(d).filter((id) => id !== colId && d[id] === use && use !== 'skip');
  others.slice(0, Math.max(0, others.length - max + 1)).forEach((id) => { d[id] = 'skip'; const s = document.querySelector(`[data-act="map-col"][data-col="${id}"]`); if (s) s.value = 'skip'; });
  d[colId] = use;
  const err = document.getElementById('map-error'); if (err && Object.values(d).includes('part')) err.hidden = true;
}
function alertField() { const p = document.querySelector('[data-new="part"]'); if (p) { p.error = 'Enter a SKU'; p.focus && p.focus(); } }
function move(arr, i, d) { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; }

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) { e.preventDefault(); if (!state.setup) return; state.flash = ''; state.importStep = 0; state.mapDraft = null; state.screen = go.dataset.go; if (state.screen === 'import') { state.screen = 'fields'; state.importStep = 1; state.scrollToImport = true; } window.scrollTo(0, 0); return render(); }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || el.hasAttribute('disabled')) return;
  const a = el.dataset.act;
  if (['pick', 'field-ph', 'field-label', 'field-type', 'field-req', 'heading', 'mode', 'sel', 'q', 'export-scope', 'map-col', 'map-titles', 'map-skus', 'sf', 'sf-col', 'sf-icon-upload', 'sf-bool', 'sf-embed'].includes(a)) return;
  if (a === 'choose') { state.choice = el.dataset.tpl; return render(); }
  if (a === 'confirm-setup') { state.setup = makeSetup(state.choice); state.picks = {}; state.searched = false; state.screen = 'home'; window.scrollTo(0, 0); return render(); }
  if (a === 'ask') { state.confirm = { kind: el.dataset.confirm, id: el.dataset.id, field: el.dataset.field }; state.openModal = 'confirm-modal'; return render(); }
  if (a === 'confirm-yes') { const c = state.confirm; state.confirm = null; if (c) runConfirmed(c); return render(); }
  if (!state.setup) return;
  const sp = setup(), fid = el.dataset.field, idx = sp.fields.findIndex((f) => f.id === fid);
  switch (a) {
    case 'guide': state.guide = Number(el.dataset.i); break;
    case 'guide-toggle': state.guideClosed = !state.guideClosed; break;
    case 'ms-state': { // My Selection preview: the tab opens the panel, the handle closes it (animated by CSS)
      const ms = document.querySelector('.ms'); if (!ms) return;
      ms.classList.toggle('is-open', el.dataset.val === 'open'); ms.classList.toggle('is-hover', el.dataset.val === 'hover');
      return;
    }
    case 'copy-code': { const code = el.dataset.code; try { navigator.clipboard.writeText(code); } catch (e) { /* prototype: clipboard may be blocked on file:// */ } showToast('Copied ' + code); return; }
    case 'billing': state.billing = el.dataset.val; break;
    case 'plan-pick': state.flash = 'Opens Shopify to approve the plan change'; break; // real app: Shopify's hosted plan page (Managed Pricing)
    case 'sf-set': sf()[el.dataset.key] = el.dataset.val; break;
    case 'change-type': state.choice = sp.type; state.screen = 'onboarding'; window.scrollTo(0, 0); break;
    case 'field-add': sp.fields.push({ id: nid('f'), label: 'New field', type: 'list', required: false }); state.flash = 'Field added. Map a column to it on your next import.'; break;
    case 'field-up': move(sp.fields, idx, -1); state.picks = {}; break;
    case 'field-down': move(sp.fields, idx, 1); state.picks = {}; break;
    case 'search': state.searched = true; break;
    case 'clear-picks': state.picks = {}; state.searched = false; break;
    case 'add-row': state.editing = null; state.prefillSku = ''; state.openModal = 'row-modal'; break;
    case 'row-edit': state.editing = el.dataset.id; state.openModal = 'row-modal'; break;
    case 'save-row': {
      const v = {}; let part = '';
      document.querySelectorAll('[data-new]').forEach((inp) => { if (inp.dataset.new === 'part') part = String(inp.value || '').trim(); else v[inp.dataset.new] = String(inp.value || '').trim(); });
      if (!part) { state.flash = ''; alertField(); return; }
      sp.rows.unshift({ id: nid('r'), v, part, mapped: (sp.looseProducts || []).some((p) => p.sku === part) }); state.prefillSku = ''; if ((sp.looseProducts || []).some((p) => p.sku === part)) sp.looseProducts = sp.looseProducts.filter((p) => p.sku !== part); state.flash = 'Row added'; break;
    }
    case 'save-edit': {
      const row = sp.rows.find((r) => r.id === state.editing); if (!row) { state.editing = null; break; }
      const v = {}; let part = '';
      document.querySelectorAll('[data-new]').forEach((inp) => { if (inp.dataset.new === 'part') part = String(inp.value || '').trim(); else v[inp.dataset.new] = String(inp.value || '').trim(); });
      if (!part) { alertField(); return; }
      if (part !== row.part) row.mapped = false; // a new SKU needs linking again
      row.v = v; row.part = part; state.editing = null; state.flash = 'Row updated'; break;
    }
    case 'sel-clear': state.sel = []; state.exportScope = null; break;
    case 'export': { const picked = state.sel || []; let sc = state.exportScope || (picked.length ? 'selected' : 'all'); if (sc === 'selected' && !picked.length) sc = 'all'; const rows = sc === 'selected' ? sp.rows.filter((r) => picked.includes(r.id)) : sc === 'unmatched' ? sp.rows.filter((r) => !r.mapped) : sp.rows; downloadCsv(sp, rows, sc === 'selected' ? 'filter-data-selected.csv' : 'filter-data.csv'); showToast('Exported ' + rows.length + ' row' + (rows.length === 1 ? '' : 's')); return; }
    case 'export-template': downloadCsv(sp, [], 'filter-data-template.csv'); return;
    case 'imp-open': state.importStep = 1; state.mapDraft = null; state.scrollToImport = true; break;
    case 'imp-cancel': state.importStep = 0; state.mapDraft = null; break;
    case 'imp-back': state.importStep = Math.max(1, state.importStep - 1); break;
    case 'imp-next': {
      if (state.importStep === 1) { // prototype: the uploaded file has the sample columns; the mapping starts from the last import
        state.mapDraft = state.mapDraft || {}; (sp.cols || []).forEach((c) => { if (!(c.id in state.mapDraft)) state.mapDraft[c.id] = c.use.split(':')[0]; });
      } else if (!Object.values(state.mapDraft || {}).includes('part')) { const err = document.getElementById('map-error'); if (err) err.hidden = false; return; }
      state.importStep += 1; break;
    }
    case 'map-import': finishImport(sp); break;
    case 'hist-download': { const h = (sp.history || [])[+el.dataset.i]; if (h) { downloadCsv(sp, sp.rows, h.file); state.flash = 'Downloaded ' + h.file; } break; } // prototype: downloads the current rows under that file name
    case 'load-sample': { // prototype only: put the store type's sample rows back, matched to the current fields by name, then by position
      const tmp = makeSetup(sp.type);
      const target = tmp.fields.map((tf, i) => sp.fields.find((f) => f.label.toLowerCase() === tf.label.toLowerCase()) || sp.fields[i]);
      sp.rows = tmp.rows.map((r) => { const v = {}; tmp.fields.forEach((tf, i) => { if (target[i]) v[target[i].id] = r.v[tf.id]; }); return { id: nid('r'), v, part: r.part, mapped: r.mapped }; });
      state.sel = []; state.flash = sp.rows.length + ' sample rows restored'; break;
    }
    case 'map': { // real app: Shopify resource picker; every row with this attachment gets the chosen product
      const part = el.dataset.part || (sp.rows.find((x) => x.id === el.dataset.id) || {}).part;
      sp.rows.forEach((r) => { if (r.part === part) r.mapped = true; }); state.flash = part + ' linked to a product'; break;
    }
    case 'relink': state.flash = 'Links checked. No new matches'; break;
    case 'loose-add': state.screen = 'data'; state.editing = null; state.prefillSku = el.dataset.sku; state.openModal = 'row-modal'; window.scrollTo(0, 0); break;
    case 'loose-universal': { const p = (sp.looseProducts || []).find((x) => x.sku === el.dataset.sku); if (p) { sp.universal = (sp.universal || []).concat([p]); state.flash = p.title + ' is now universal'; } break; }
    case 'universal-remove': { const p = (sp.universal || []).find((x) => x.sku === el.dataset.sku); sp.universal = (sp.universal || []).filter((x) => x.sku !== el.dataset.sku); if (p) state.flash = p.title + ' is no longer universal'; break; }
    case 'universal-add': state.flash = 'Opens the Shopify product picker'; break;
    default: return;
  }
  render();
});

render();
setTimeout(() => { if (window.customElements && !customElements.get('s-page')) document.getElementById('cdn-note').hidden = false; }, 5000);
