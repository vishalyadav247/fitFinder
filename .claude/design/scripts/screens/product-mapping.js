// Screen: Product mapping — connects filter rows to real products in the store. Spec: .claude/specs/product-mapping.md
// A filter row only says "attachment X fits Y". Shoppers can only see, buy and get a fits badge for X once it is linked to a product.
S.mapping = () => {
  const sp = setup();
  // Prototype data saved before these lists existed gets the sample products.
  if (!sp.looseProducts) { sp.looseProducts = makeSetup(sp.type).looseProducts; sp.universal = sp.universal || []; }
  // Unlinked rows, grouped by attachment (one line per SKU / link, with how many rows use it).
  const groups = [];
  sp.rows.filter((r) => !r.mapped).forEach((r) => {
    const g = groups.find((x) => x.part === r.part);
    if (g) g.rows.push(r); else groups.push({ part: r.part, rows: [r] });
  });
  const kind = (a) => /\/collections\//.test(a) ? 'Collection link' : /\/products\//.test(a) ? 'Product link' : 'SKU';
  const fits = (r) => sp.fields.map((f) => showValue(f, r.v[f.id])).join(' · ');
  const loose = (sp.looseProducts || []).filter((p) => !(sp.universal || []).some((u) => u.sku === p.sku));
  const universal = sp.universal || [];

  return `<s-page heading="Product mapping" inlineSize="base">
  <s-button slot="primary-action" variant="primary" icon="refresh" data-act="relink">Check links again</s-button>
  <s-stack gap="base">
    <s-section padding="none" accessibilityLabel="Unlinked rows">
      <s-box padding="base"><s-stack gap="small-100">
        <s-stack direction="inline" gap="small-200" alignItems="center"><h2 class="sec-title">Unlinked rows</h2><s-badge tone="${groups.length ? 'warning' : 'success'}">${groups.length} to link</s-badge></s-stack>
        <s-text color="subdued">Each filter row points to a product through its Attachment (usually a SKU). We couldn't find these in your store, so shoppers don't see them in search results.</s-text>
      </s-stack></s-box>
      ${groups.length ? `<s-table><s-table-header-row><s-table-header listSlot="primary">Attachment</s-table-header><s-table-header>Type</s-table-header><s-table-header>Fits</s-table-header><s-table-header format="numeric">Rows</s-table-header><s-table-header>Action</s-table-header></s-table-header-row>
        <s-table-body>${groups.map((g) => `<s-table-row><s-table-cell><s-text type="strong">${esc(g.part)}</s-text></s-table-cell><s-table-cell>${kind(g.part)}</s-table-cell>
          <s-table-cell><s-text color="subdued">${esc(fits(g.rows[0]))}${g.rows.length > 1 ? ` +${g.rows.length - 1} more` : ''}</s-text></s-table-cell><s-table-cell>${g.rows.length}</s-table-cell>
          <s-table-cell><s-button data-act="map" data-id="${g.rows[0].id}" data-part="${esc(g.part)}">Choose product</s-button></s-table-cell></s-table-row>`).join('')}</s-table-body></s-table>`
        : '<s-box padding="base" paddingBlockStart="none"><s-banner tone="success" heading="Every row is linked to a product"></s-banner></s-box>'}
    </s-section>

    <s-section padding="none" accessibilityLabel="Products without filter data">
      <s-box padding="base"><s-stack gap="small-100">
        <s-stack direction="inline" gap="small-200" alignItems="center"><h2 class="sec-title">Products without filter data</h2><s-badge tone="${loose.length ? 'warning' : 'success'}">${loose.length} products</s-badge></s-stack>
        <s-text color="subdued">These products have no filter rows, so they never appear in a search. Add rows for them, or mark them as universal if they fit every ${esc(sp.noun)}.</s-text>
      </s-stack></s-box>
      ${loose.length ? `<s-table><s-table-header-row><s-table-header listSlot="primary">Product</s-table-header><s-table-header>SKU</s-table-header><s-table-header>Action</s-table-header></s-table-header-row>
        <s-table-body>${loose.map((p) => `<s-table-row><s-table-cell><s-text type="strong">${esc(p.title)}</s-text></s-table-cell><s-table-cell>${esc(p.sku)}</s-table-cell>
          <s-table-cell><s-stack direction="inline" gap="small-200"><s-button data-act="loose-add" data-sku="${esc(p.sku)}">Add filter row</s-button><s-button variant="tertiary" data-act="loose-universal" data-sku="${esc(p.sku)}">Mark as universal</s-button></s-stack></s-table-cell></s-table-row>`).join('')}</s-table-body></s-table>`
        : '<s-box padding="base" paddingBlockStart="none"><s-banner tone="success" heading="Every product has filter data or is universal"></s-banner></s-box>'}
    </s-section>

    <s-section padding="none" accessibilityLabel="Universal products">
      <s-box padding="base"><s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
        <s-stack gap="small-100"><h2 class="sec-title">Universal products</h2>
          <s-text color="subdued">Shown in every search result, whatever the shopper picks. For example tools, cleaning kits or cables.</s-text></s-stack>
        <s-button icon="plus" data-act="universal-add">Add products</s-button>
      </s-grid></s-box>
      ${universal.length ? `<s-table><s-table-header-row><s-table-header listSlot="primary">Product</s-table-header><s-table-header>SKU</s-table-header><s-table-header>Action</s-table-header></s-table-header-row>
        <s-table-body>${universal.map((p) => `<s-table-row><s-table-cell><s-text type="strong">${esc(p.title)}</s-text></s-table-cell><s-table-cell>${esc(p.sku)}</s-table-cell>
          <s-table-cell><s-button variant="tertiary" data-act="universal-remove" data-sku="${esc(p.sku)}">Remove</s-button></s-table-cell></s-table-row>`).join('')}</s-table-body></s-table>`
        : '<s-box padding="base" paddingBlockStart="none"><s-text color="subdued">No universal products yet.</s-text></s-box>'}
    </s-section>
  </s-stack>
  </s-page>`;
};
