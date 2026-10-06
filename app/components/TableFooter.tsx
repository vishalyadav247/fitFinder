// Footer under a paged s-table: "Showing 1–10 of 230 products" on the left, previous · page x of
// y · next in the middle, rows per page on the right. Used by the Product mapping tables.
/** Page count and the 1-based item range shown on a page (clamped to the last page). */
export function pageRange(total: number, page: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(page, 1), pages);
  const from = total ? (current - 1) * pageSize + 1 : 0;
  const to = Math.min(current * pageSize, total);
  return { pages, current, from, to };
}

export function TableFooter({
  total,
  page,
  pageSize,
  pageSizes,
  noun,
  disabled,
  onPage,
  onPageSize,
}: {
  total: number;
  page: number;
  pageSize: number;
  pageSizes: readonly number[];
  /** Plural, lower case: "products", "attachments". */
  noun: string;
  disabled?: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const { pages, current, from, to } = pageRange(total, page, pageSize);
  const fmt = (n: number) => n.toLocaleString("en-US");

  return (
    <s-box
      padding="small-200"
      paddingInline="base"
      borderColor="base"
      borderWidth="base none none none"
    >
      {/* Count left, pagination centred, rows per page right. */}
      <s-grid
        gridTemplateColumns="minmax(0, 1fr) auto minmax(0, 1fr)"
        gap="base"
        alignItems="center"
      >
        <s-text color="subdued">
          Showing {fmt(from)}–{fmt(to)} of {fmt(total)} {noun}
        </s-text>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-button
            icon="chevron-left"
            variant="tertiary"
            accessibilityLabel="Previous page"
            disabled={disabled || current <= 1}
            onClick={() => onPage(current - 1)}
          />
          <s-text color="subdued">
            Page {fmt(current)} of {fmt(pages)}
          </s-text>
          <s-button
            icon="chevron-right"
            variant="tertiary"
            accessibilityLabel="Next page"
            disabled={disabled || current >= pages}
            onClick={() => onPage(current + 1)}
          />
        </s-stack>
        <div className="ff-tf-size">
          <s-text color="subdued">Rows per page</s-text>
          <div className="ff-tf-select">
            <s-select
              label="Rows per page"
              labelAccessibilityVisibility="exclusive"
              value={String(pageSize)}
              disabled={disabled}
              onChange={(e) => onPageSize(Number(e.currentTarget.value))}
            >
              {pageSizes.map((n) => (
                <s-option key={n} value={String(n)}>
                  {n}
                </s-option>
              ))}
            </s-select>
          </div>
        </div>
      </s-grid>
    </s-box>
  );
}
