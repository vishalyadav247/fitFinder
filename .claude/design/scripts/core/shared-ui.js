// Shared UI: field chips, the search widget preview, and the S object that holds every screen.
/* ---------- shared pieces ---------- */
const chips = (labels) => `<span class="chips">${labels.map((l, i) => `<s-badge>${esc(l)}</s-badge>`).join('<span aria-hidden="true" style="color:#8A8A8A">›</span>')}</span>`;
function widget(sp) {
  const sel = sp.fields.map((f, i) => {
    const ready = sp.fields.slice(0, i).every((p) => state.picks[p.id]);
    const opts = ready ? optionsFor(sp, i) : [];
    return `<s-select label="${esc(f.label)}" data-act="pick" data-field="${f.id}" placeholder="${esc(placeholderFor(f))}" value="${esc(state.picks[f.id] || '')}"${ready && opts.length ? '' : ' disabled'}>
      ${opts.map((o) => `<s-option value="${esc(o)}">${esc(o)}</s-option>`).join('')}</s-select>`;
  }).join('');
  const all = sp.fields.length && sp.fields.every((f) => state.picks[f.id]);
  let results = '';
  if (state.searched && all) {
    const hits = sp.rows.filter((r) => rowMatches(sp, r, sp.fields.length));
    results = hits.length ? hits.map((r) => `<s-box padding="small" background="base" borderRadius="base" border="base"><s-stack direction="inline" gap="small" alignItems="center" justifyContent="space-between">
      <s-text type="strong">${esc(r.part)}</s-text>${r.mapped ? '<s-badge tone="success" icon="check-circle">Fits your ' + esc(sp.noun) + '</s-badge>' : '<s-badge tone="warning">No product linked</s-badge>'}</s-stack></s-box>`).join('')
      : '<s-paragraph color="subdued">Nothing fits this selection yet.</s-paragraph>';
  }
  return `<div class="widget"><h3>${esc(sp.heading)}</h3>
    ${sp.fields.length ? sel : '<s-paragraph color="subdued">Add at least one field to show the search.</s-paragraph>'}
    ${sp.rows.length ? '' : '<s-paragraph color="subdued">Import data to fill these dropdowns.</s-paragraph>'}
    <s-button-group><s-button slot="primary-action" variant="primary" data-act="search"${all ? '' : ' disabled'}>Show results</s-button><s-button slot="secondary-actions" data-act="clear-picks">Reset</s-button></s-button-group>
    ${results}</div>`;
}

/* ---------- screens ---------- */
const S = {};

// Confirmation modal for every destructive action. Buttons use data-act="ask" + data-confirm="<kind>";
// the modal's red button runs the action (see 'confirm-yes' in app.js).
// Rows that are exact copies (same field values and SKU) of an earlier row.
function duplicateRows(sp) {
  const seen = new Set();
  return sp.rows.filter((r) => { const k = JSON.stringify([sp.fields.map((f) => r.v[f.id]), r.part]).toLowerCase().replace(/\s+/g, ''); if (seen.has(k)) return true; seen.add(k); return false; });
}

function confirmText(c) {
  const sp = setup();
  if (!sp && c.kind !== 'reset') return null;
  if (c.kind === 'row-del') {
    const r = sp.rows.find((x) => x.id === c.id); if (!r) return null;
    const what = sp.fields.map((f) => showValue(f, r.v[f.id])).join(' · ');
    return { title: 'Delete this row?', body: `SKU ${r.part} (${what}) will be removed from your filter data. This can't be undone.`, cta: 'Delete row' };
  }
  if (c.kind === 'sel-delete') {
    const n = (state.sel || []).length;
    return { title: `Delete ${n} row${n === 1 ? '' : 's'}?`, body: `The selected row${n === 1 ? '' : 's'} will be removed from your filter data. This can't be undone.`, cta: `Delete ${n} row${n === 1 ? '' : 's'}` };
  }
  if (c.kind === 'wipe') {
    return { title: 'Delete all filter rows?', body: `All ${sp.rows.length} rows will be removed. Your search will show no results until you import data again. Products in Shopify are not changed. This can't be undone.`, cta: 'Delete all rows' };
  }
  if (c.kind === 'field-del') {
    const f = sp.fields.find((x) => x.id === c.field); if (!f) return null;
    return { title: `Delete the ${f.label} field?`, body: `Shoppers will no longer see the ${f.label} dropdown, and its values in your filter data won't be used. This can't be undone.`, cta: 'Delete field' };
  }
  if (c.kind === 'dedupe') {
    const n = duplicateRows(sp).length;
    if (!n) return { title: 'No duplicate rows', body: 'Every row is unique, so there is nothing to remove.', cta: null };
    return { title: `Remove ${n} duplicate row${n === 1 ? '' : 's'}?`, body: `Rows that are the same as another row apart from upper/lower case and spaces will be removed. One of each is kept. This can't be undone.`, cta: `Remove ${n} row${n === 1 ? '' : 's'}` };
  }
  if (c.kind === 'import-remove') {
    return { title: 'Delete the rows listed in this file?', body: "Rows in your filter data that match new-filter-data.csv exactly will be deleted. This can't be undone.", cta: 'Delete rows' };
  }
  if (c.kind === 'import-replace') {
    return { title: `Replace all ${sp.rows.length} rows?`, body: "Every current filter row is deleted, then the file is imported. Download a backup from Import history first if you may need them. This can't be undone.", cta: 'Replace all rows' };
  }
  if (c.kind === 'reset') {
    return { title: 'Start over?', body: 'This clears everything in this browser and takes you back to onboarding.', cta: 'Start over' };
  }
  return null;
}

function confirmModal() {
  const t = state.confirm ? confirmText(state.confirm) : null;
  if (!t) return '';
  return `<s-modal id="confirm-modal" heading="${esc(t.title)}" size="small">
    <s-paragraph>${esc(t.body)}</s-paragraph>
    ${t.cta ? `<s-button slot="primary-action" variant="primary" tone="critical" data-act="confirm-yes">${esc(t.cta)}</s-button>
    <s-button slot="secondary-actions" commandFor="confirm-modal" command="--hide">Cancel</s-button>` : '<s-button slot="primary-action" commandFor="confirm-modal" command="--hide">Close</s-button>'}
  </s-modal>`;
}

// Notifications after an action use Shopify's toast. In the real app call App Bridge:
//   shopify.toast.show('Row updated', { duration: 5000 })   or   { isError: true }
// This draws a look-alike so the prototype works outside the Shopify admin.
function showToast(message, isError) {
  if (window.shopify && window.shopify.toast) { window.shopify.toast.show(message, { isError: !!isError }); return; }
  document.querySelectorAll('.ff-toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'ff-toast' + (isError ? ' is-error' : '');
  t.setAttribute('role', isError ? 'alert' : 'status');
  t.innerHTML = '<span></span><button aria-label="Dismiss">×</button>';
  t.querySelector('span').textContent = message;
  t.querySelector('button').addEventListener('click', () => t.remove());
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('out'), 4600);
  setTimeout(() => t.remove(), 5000);
}

// Text in a field's empty dropdown on the storefront, e.g. "Select make". Set per field on Search setup.
function placeholderFor(f) { return f.placeholder || 'Select ' + f.label.toLowerCase(); }
