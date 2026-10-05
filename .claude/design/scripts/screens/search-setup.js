// Screen: Search setup — the dropdowns shoppers use (search fields), CSV import and import history. File columns are mapped to these
// fields during each import (step 2 of the import card on this page). Spec: .claude/specs/search-setup.md
S.fields = () => {
  const sp = setup(), t = tpl();

  // One row per field, edited in place (saves on change). A grid (not s-table) so the inputs get the space
  // and the small columns stay narrow; header and rows share the same column template (.fgrid).
  const fieldRows = sp.fields.map((f, i) => `<div class="fgrid frow">
      <span class="num-dot n-plain">${i + 1}</span>
      <s-text-field label="Field ${i + 1} name" labelAccessibilityVisibility="exclusive" data-act="field-label" data-field="${f.id}" value="${esc(f.label)}"></s-text-field>
      <s-text-field label="Placeholder for ${esc(f.label)}" labelAccessibilityVisibility="exclusive" data-act="field-ph" data-field="${f.id}" value="${esc(placeholderFor(f))}"></s-text-field>
      <s-select label="Type of ${esc(f.label)}" labelAccessibilityVisibility="exclusive" data-act="field-type" data-field="${f.id}" value="${f.type}"><s-option value="list">Dropdown</s-option><s-option value="years">Year range</s-option></s-select>
      <s-checkbox label="Required" accessibilityLabel="${esc(f.label)} is required" data-act="field-req" data-field="${f.id}"${f.required ? ' checked' : ''}></s-checkbox>
      <s-stack direction="inline" gap="small-100">
        <s-button variant="tertiary" icon="arrow-up" accessibilityLabel="Move ${esc(f.label)} up" data-act="field-up" data-field="${f.id}"${i === 0 ? ' disabled' : ''}></s-button>
        <s-button variant="tertiary" icon="arrow-down" accessibilityLabel="Move ${esc(f.label)} down" data-act="field-down" data-field="${f.id}"${i === sp.fields.length - 1 ? ' disabled' : ''}></s-button>
        <s-button variant="tertiary" icon="delete" tone="critical" accessibilityLabel="Delete ${esc(f.label)}" data-act="ask" data-confirm="field-del" data-field="${f.id}"></s-button>
      </s-stack>
    </div>`).join('');

  return `<s-page heading="Search setup" inlineSize="base">
  <s-button slot="secondary-actions" icon="store" data-act="change-type">Change store type</s-button>
  <s-stack gap="base">
    <s-section padding="none" accessibilityLabel="Fields shoppers pick">
      <s-box padding="base"><s-stack gap="small-100">
        <h2 class="sec-title">Fields shoppers pick</h2>
        <s-text color="subdued">${esc(t.label)} · Shoppers pick these in this order. When you import a CSV, you choose which column fills each field.</s-text>
      </s-stack></s-box>
      <div class="fgrid fhead" aria-hidden="true"><span>Order</span><span>Field name</span><span>Placeholder</span><span>Type</span><span>Required</span><span>Actions</span></div>
      ${fieldRows}
      <s-box padding="base"><s-stack direction="inline" gap="base" alignItems="center"><s-button icon="plus" data-act="field-add">Add field</s-button>
        <s-text color="subdued">${sp.type === 'automotive' ? 'For example Engine, Trim or Body type' : sp.type === 'phones' ? 'For example Storage size or Colour' : sp.type === 'beauty' ? 'For example Concern, Skin type or Age group' : 'For example Type, Series or Model number'}</s-text></s-stack></s-box>
    </s-section>

    ${state.importStep ? `<div id="import-card">${importCard(sp)}</div>` : importHistory(sp)}
  </s-stack>
  </s-page>`;
};

// Import history: the last 5 files, newest first, each downloadable as a backup.
function importHistory(sp) {
  const hist = (sp.history || []).slice(0, 5);
  return `<s-section padding="none" accessibilityLabel="Import history">
      <s-box padding="base"><s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
        <s-stack gap="small-100"><h2 class="sec-title">Import history</h2>
          <s-text color="subdued">${hist.length ? 'We keep your last 5 files, so you can download a backup any time. A new import removes the oldest one.' : 'Nothing imported yet. Upload a CSV with your SKUs and what they fit.'}</s-text></s-stack>
        <s-button variant="primary" icon="upload" data-act="imp-open">${hist.length ? 'Import new file' : 'Import CSV'}</s-button>
      </s-grid></s-box>
      ${hist.length ? `<s-table><s-table-header-row><s-table-header listSlot="primary">File</s-table-header><s-table-header>Imported</s-table-header><s-table-header>Import type</s-table-header><s-table-header format="numeric">Rows</s-table-header><s-table-header>Backup</s-table-header></s-table-header-row>
        <s-table-body>${hist.map((h, i) => `<s-table-row><s-table-cell><s-stack direction="inline" gap="small-200" alignItems="center"><s-text type="strong">${esc(h.file)}</s-text>${i === 0 ? '<s-badge tone="success">Current</s-badge>' : ''}</s-stack></s-table-cell><s-table-cell>${esc(h.when)}</s-table-cell><s-table-cell>${esc(h.mode)}</s-table-cell><s-table-cell>${esc(h.rows)}</s-table-cell>
          <s-table-cell><s-button variant="tertiary" icon="download" accessibilityLabel="Download ${esc(h.file)}" data-act="hist-download" data-i="${i}">Download</s-button></s-table-cell></s-table-row>`).join('')}</s-table-body></s-table>` : ''}
    </s-section>`;
}

// What a file column can be mapped to: exactly the search fields, plus Attachment (what each row links to: SKU, product or collection).
// A Year range field can take one column (2015-2020) or two (left = from, right = to).
function mapTargets(sp) {
  return [['skip', 'Map column']].concat(sp.fields.map((f) => [f.id, f.label]), [['part', 'Attachment']]);
}

// CSV import, shown as a card below the fields (in place of Last import): 1 Upload file › 2 Map columns › 3 Review and import.
function importCard(sp) {
  const st = state.importStep;
  const stepper = `<ol class="stepper small" aria-label="Import steps">${['Upload file', 'Map columns', 'Review and import'].map((x, i) =>
    `<li class="${st > i + 1 ? 'done' : ''}${st === i + 1 ? ' cur' : ''}${i > 0 && st > i ? ' line-on' : ''}"><span class="stp"><span class="dot">${st > i + 1 ? svg('check', 14, 2.8) : i + 1}</span><span class="lab">${x}</span></span></li>`).join('')}</ol>`;
  const body = st === 1 ? uploadStep() : st === 2 ? mapStep(sp) : reviewStep();
  // Next on steps 1–2, Start import on the last step. Imports that delete rows are red and ask for confirmation first.
  const finish = state.mode === 'remove' ? '<s-button variant="primary" tone="critical" data-act="ask" data-confirm="import-remove">Start import</s-button>'
    : state.mode === 'replace' ? '<s-button variant="primary" tone="critical" data-act="ask" data-confirm="import-replace">Start import</s-button>'
    : '<s-button variant="primary" data-act="map-import">Start import</s-button>';
  const next = st === 1 ? '<s-button variant="primary" data-act="imp-next">Next</s-button>'
    : st === 2 ? '<s-button variant="primary" data-act="imp-next">Next</s-button>' : finish;
  return `<s-section accessibilityLabel="Import CSV"><h2 class="sec-title sec-gap">Import CSV</h2>
    <s-stack gap="large">
      ${stepper}
      ${body}
      <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
        <s-box>${st > 1 ? '<s-button data-act="imp-back">Back</s-button>' : ''}</s-box>
        <s-stack direction="inline" gap="small-200"><s-button data-act="imp-cancel">Cancel import</s-button>${next}</s-stack>
      </s-grid>
    </s-stack>
  </s-section>`;
}

// Step 1: choose the file and what the import does.
function uploadStep() {
  return `<s-stack gap="base">
      <s-drop-zone label="Upload a .csv or .csv.gz file, up to 100 MB" accept=".csv,.gz"></s-drop-zone>
      <s-stack direction="inline" gap="small" alignItems="center"><s-text color="subdued">Not sure about the format?</s-text><s-button variant="tertiary" icon="download" data-act="export-template">Download a CSV template</s-button></s-stack>
      <s-choice-list label="What should this import do?" data-act="mode">
        <s-choice value="upsert"${state.mode === 'upsert' ? ' selected' : ''}>Add and update rows (recommended)<s-text slot="details">New rows are added and changed rows are updated. Nothing else is touched.</s-text></s-choice>
        <s-choice value="replace"${state.mode === 'replace' ? ' selected' : ''}>Replace all rows<s-text slot="details">Deletes every current row first, then imports the file.</s-text></s-choice>
        <s-choice value="remove"${state.mode === 'remove' ? ' selected' : ''}>Delete the rows listed in this file<s-text slot="details">Removes rows that match the file exactly. Rows not in the file stay.</s-text></s-choice>
      </s-choice-list>
    </s-stack>`;
}

// Step 2: a preview of the file with a "Map column" dropdown above each column.
// Pre-filled from the last import; columns left on "Map column" are ignored.
function mapStep(sp) {
  const cols = sp.cols || [], draft = state.mapDraft || {}, targets = mapTargets(sp);
  const structure = sp.fields.map((f) => f.label).join(' / ');
  const rows = Math.max(0, ...cols.map((c) => c.samples.length));
  return `<s-stack gap="base">
      <s-stack gap="none">
        <s-text type="strong">Map the columns in your file to your search fields (${esc(structure)}) and the Attachment.</s-text>
        <s-text color="subdued">Columns you don't map are ignored. The first rows of your file are shown below. We filled in the mapping from your last import.</s-text>
      </s-stack>
      <s-checkbox label="Column titles in the first row" data-act="map-titles"${state.mapNoTitles ? '' : ' checked'}></s-checkbox>
      <div class="map-scroll"><table class="map-grid${state.mapNoTitles ? ' no-titles' : ''}">
        <thead><tr>${cols.map((c) => `<th><s-select label="Map ${esc(c.name)}" labelAccessibilityVisibility="exclusive" data-act="map-col" data-col="${c.id}" value="${esc(draft[c.id] || 'skip')}">${targets.map(([v, l]) => `<s-option value="${esc(v)}">${esc(l)}</s-option>`).join('')}</s-select></th>`).join('')}</tr>
        <tr class="mg-titles">${cols.map((c) => `<td>${esc(c.name)}</td>`).join('')}</tr></thead>
        <tbody>${Array.from({ length: rows }, (_, i) => `<tr>${cols.map((c) => `<td>${esc(c.samples[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <s-checkbox label="Look for SKUs in the Attachment column" details="Check it if the Attachment column has product SKUs. It can make the import take longer. Leave it off for product or collection links." data-act="map-skus"${state.mapNoSkus ? '' : ' checked'}></s-checkbox>
      <div id="map-error" hidden><s-banner tone="critical" heading="Map the Attachment column">Each row needs an Attachment: the product SKU, product link or collection link it points to.</s-banner></div>
      <s-text color="subdued">${sp.fields.some((f) => f.type === 'years') ? `${esc(sp.fields.filter((f) => f.type === 'years').map((f) => f.label).join(', '))} can use one column (like 2015-2020) or two columns: the left one is from, the right one is to. ` : ''}Missing a field? Add it under Fields shoppers pick, then map a column to it.</s-text>
    </s-stack>`;
}

// Step 3: what will change. Counts and the note depend on the import type.
function reviewStep() {
  const mode = { upsert: 'Add and update rows', replace: 'Replace all rows', remove: 'Delete the rows listed in this file' }[state.mode] || 'Add and update rows';
  const counts = state.mode === 'remove' ? [['Rows deleted', '[deleted]'], ['Not found', '[not found]'], ['Rows left', '[left]']]
    : state.mode === 'replace' ? [['Current rows deleted', String(setup().rows.length)], ['Rows imported', '[imported]'], ['Errors', '[errors]']]
    : [['Rows added', '[added]'], ['Rows updated', '[updated]'], ['Unchanged', '[same]'], ['Errors', '[errors]']];
  const note = (heading, text, report) => `<s-banner tone="warning" heading="${heading}"><s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center"><s-text>${text}</s-text><s-button variant="tertiary" icon="download">${report}</s-button></s-grid></s-banner>`;
  return `<s-stack gap="base">
      <s-text color="subdued">new-filter-data.csv · ${esc(mode)}</s-text>
      <s-grid gridTemplateColumns="repeat(${counts.length}, minmax(0, 1fr))" gap="base">
        ${counts.map(([l, n]) =>
          `<s-box padding="base" background="subdued" borderRadius="base"><s-stack gap="none"><s-text color="subdued">${l}</s-text><s-text type="strong">${n}</s-text></s-stack></s-box>`).join('')}
      </s-grid>
      ${state.mode === 'remove' ? note('Only exact matches are deleted', 'A row is deleted when every mapped column matches. Rows in the file with no match are listed in the report.', 'Not found report')
        : state.mode === 'replace' ? note('All current rows are deleted first', 'Download a backup from Import history if you may need them. Rows with errors are skipped.', 'Error report')
        : note('Rows with errors are skipped. Everything else imports.', "For example an empty required field, or a SKU that isn't in your store.", 'Error report')}
    </s-stack>`;
}
