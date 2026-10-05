// Screen: Filter data — rows table, export and clean up. Import CSV lives on Search setup (columns are chosen there). Spec: .claude/specs/fitment-data.md
S.data = () => {
  const sp = setup();
  const un = sp.rows.filter((r) => !r.mapped).length;
  return `<s-page heading="Filter data" inlineSize="base">
  <s-button slot="primary-action" variant="primary" icon="upload" data-go="import">Import CSV</s-button>
  <s-button slot="secondary-actions" commandFor="export-modal" command="--show">Export</s-button>
  <s-stack gap="base">
  ${un ? `<s-banner tone="warning" heading="${un} SKU${un === 1 ? " isn't" : "s aren't"} linked to a product">
    <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
      <s-text>Shoppers won't see ${un === 1 ? 'this row' : 'these rows'} in search results until ${un === 1 ? "it's" : "they're"} linked to a product.</s-text>
      <s-button data-go="mapping">Link products</s-button>
    </s-grid>
  </s-banner>` : ''}
  ${rowsTab(sp)}
  ${cleanupCard()}
  </s-stack>
  ${exportModal(sp)}
  ${rowModal(sp)}
  </s-page>`;
};

// Add / edit row in a modal. Opened by the Add row button or a row's Edit button (see state.openModal in app.js).
function rowModal(sp) {
  const row = state.editing ? sp.rows.find((r) => r.id === state.editing) : null;
  return `<s-modal id="row-modal" heading="${row ? 'Edit row' : 'Add row'}">
    <div class="add-grid">${sp.fields.map((f) => `<s-text-field label="${esc(f.label)}" data-new="${f.id}" value="${row ? esc(row.v[f.id] || '') : ''}" placeholder="${f.type === 'years' ? 'e.g. 2015-2020 or 2019-' : ''}"></s-text-field>`).join('')}
      <s-text-field label="SKU" data-new="part" value="${row ? esc(row.part) : esc(state.prefillSku || '')}" required></s-text-field></div>
    ${row && row.mapped ? '<s-box paddingBlockStart="base"><s-text color="subdued">Changing the SKU unlinks this row from its product.</s-text></s-box>' : ''}
    <s-button slot="primary-action" variant="primary" data-act="${row ? 'save-edit' : 'save-row'}">${row ? 'Save changes' : 'Add row'}</s-button>
    <s-button slot="secondary-actions" commandFor="row-modal" command="--hide">Cancel</s-button>
  </s-modal>`;
}

// Export options, opened from the page's Export button.
function exportModal(sp) {
  const un = sp.rows.filter((r) => !r.mapped).length;
  const picked = (state.sel || []).length;
  // Default to the selection when rows are selected; "selected" isn't available without one.
  let scope = state.exportScope || (picked ? 'selected' : 'all');
  if (scope === 'selected' && !picked) scope = 'all';
  return `<s-modal id="export-modal" heading="Export filter data">
    <s-stack gap="base">
      <s-paragraph color="subdued">The file uses the same columns as the import, so you can edit it and import it again.</s-paragraph>
      <s-choice-list label="What to export" data-act="export-scope">
        <s-choice value="all"${scope === 'all' ? ' selected' : ''}>All rows (${sp.rows.length})</s-choice>
        <s-choice value="selected"${scope === 'selected' ? ' selected' : ''}${picked ? '' : ' disabled'}>Selected rows (${picked})${picked ? '' : '<s-text slot="details">Select rows in the table first.</s-text>'}</s-choice>
        <s-choice value="unmatched"${scope === 'unmatched' ? ' selected' : ''}>Only rows with unlinked SKUs (${un})</s-choice>
      </s-choice-list>
      <s-text color="subdued">Format: CSV (UTF-8)</s-text>
    </s-stack>
    <s-button slot="primary-action" variant="primary" data-act="export" commandFor="export-modal" command="--hide">Export CSV</s-button>
    <s-button slot="secondary-actions" commandFor="export-modal" command="--hide">Cancel</s-button>
  </s-modal>`;
}

function rowsTab(sp) {
  const sel = state.sel || [];
  const bulk = sel.length ? `<div class="bulk"><s-text type="strong">${sel.length} selected</s-text><s-button-group><s-button slot="secondary-actions" data-act="sel-clear">Clear selection</s-button><s-button slot="secondary-actions" icon="export" commandFor="export-modal" command="--show">Export selected</s-button><s-button slot="secondary-actions" tone="critical" icon="delete" data-act="ask" data-confirm="sel-delete">Delete selected</s-button></s-button-group></div>` : '';
  return `
  <s-section padding="none">
    <s-box padding="base"><s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
      <s-search-field label="Search rows" labelAccessibilityVisibility="exclusive" data-act="q" placeholder="Search ${esc(sp.fields.map((f) => f.label.toLowerCase()).join(', '))} or SKU"></s-search-field>
      <s-button icon="plus" data-act="add-row">Add row</s-button>
    </s-grid></s-box>
    ${bulk}
    ${sp.rows.length ? `<s-table>
      <s-table-header-row><s-table-header listSlot="primary">Select</s-table-header>${sp.fields.map((f) => `<s-table-header>${esc(f.label)}</s-table-header>`).join('')}<s-table-header>SKU</s-table-header><s-table-header>Product</s-table-header><s-table-header>Actions</s-table-header></s-table-header-row>
      <s-table-body>${sp.rows.map((r) => `<s-table-row data-row-text="${esc((sp.fields.map((f) => r.v[f.id]).join(' ') + ' ' + r.part).toLowerCase())}">
        <s-table-cell><s-checkbox accessibilityLabel="Select ${esc(r.part)}" data-act="sel" data-id="${r.id}"${sel.includes(r.id) ? ' checked' : ''}></s-checkbox></s-table-cell>
        ${sp.fields.map((f, i) => `<s-table-cell>${i === 0 ? `<s-text type="strong">${esc(showValue(f, r.v[f.id]))}</s-text>` : esc(showValue(f, r.v[f.id]))}</s-table-cell>`).join('')}
        <s-table-cell>${esc(r.part)}</s-table-cell>
        <s-table-cell>${r.mapped ? '<s-badge tone="success">Mapped</s-badge>' : '<s-badge tone="warning">Unmatched</s-badge>'}</s-table-cell>
        <s-table-cell><s-stack direction="inline" gap="small-300"><s-button variant="tertiary" icon="edit" accessibilityLabel="Edit ${esc(r.part)}" data-act="row-edit" data-id="${r.id}"></s-button><s-button variant="tertiary" icon="delete" tone="critical" accessibilityLabel="Delete ${esc(r.part)}" data-act="ask" data-confirm="row-del" data-id="${r.id}"></s-button></s-stack></s-table-cell>
      </s-table-row>`).join('')}</s-table-body>
    </s-table>
    <s-box padding="base"><s-text color="subdued" id="row-count">${sp.rows.length} rows</s-text></s-box>`
    : `<s-box padding="large"><s-stack gap="base" alignItems="center"><s-heading>No rows yet</s-heading><s-paragraph color="subdued">Import a CSV or add rows by hand.</s-paragraph><s-button variant="tertiary" data-act="load-sample">Restore sample rows (prototype only)</s-button><s-button variant="primary" data-go="import">Import CSV</s-button></s-stack></s-box>`}
  </s-section>`;
}

function cleanupCard() {
  return `  <s-section accessibilityLabel="Clean up">
    <s-stack direction="inline" gap="small" alignItems="center"><span class="tile t-slate cu-ico"><s-icon type="eraser" size="small"></s-icon></span><h2 class="sec-title">Clean up</h2></s-stack>
    <s-box paddingBlockStart="base">
    <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
      <s-stack gap="none"><s-text type="strong">Remove duplicate rows</s-text><s-text color="subdued">Deletes rows that are exactly the same, keeping one of each.</s-text></s-stack>
      <s-stack alignItems="end"><s-button data-act="ask" data-confirm="dedupe">Remove duplicates</s-button></s-stack>
      <s-stack gap="none"><s-text type="strong">Delete all rows</s-text><s-text color="subdued">Removes every filter row. Products in Shopify are not changed.</s-text></s-stack>
      <s-stack alignItems="end"><s-button tone="critical" data-act="ask" data-confirm="wipe">Delete all rows</s-button></s-stack>
    </s-grid>
    </s-box>
  </s-section>`;
}

function downloadCsv(sp, rows, name) {
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [sp.fields.map((f) => q(f.label)).concat(q('SKU')).join(',')]
    .concat(rows.map((r) => sp.fields.map((f) => q(r.v[f.id])).concat(q(r.part)).join(',')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
