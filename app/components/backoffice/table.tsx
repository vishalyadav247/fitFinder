// Footer of the backoffice's paged tables (Stores, Logs), the same standard as the app's
// (table-paging.ts): "Showing x–y of n" left, pager centred, rows per page (10 / 25 / 50) right.
import { TABLE_PAGE_SIZES } from "../table-paging";
import { n } from "./format";
import { Icon } from "./ui";

export function TableFooter({
  total,
  page,
  pageSize,
  busy,
  onPage,
  onPageSize,
}: {
  total: number;
  page: number;
  pageSize: number;
  busy?: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="bo-table-foot">
      <span className="bo-help">
        Showing {n(from)}–{n(to)} of {n(total)}
      </span>
      <span className="bo-pager">
        <button
          type="button"
          className="bo-btn bo-btn--ghost bo-btn--sm"
          disabled={page <= 1 || busy}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <Icon name="back" size={14} />
        </button>
        <span className="bo-help">
          Page {n(page)} of {n(pages)}
        </span>
        <button
          type="button"
          className="bo-btn bo-btn--ghost bo-btn--sm bo-flip"
          disabled={page >= pages || busy}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <Icon name="back" size={14} />
        </button>
      </span>
      <label className="bo-rows-per-page">
        <span className="bo-help">Rows per page</span>
        <select
          className="bo-input bo-input--sm"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.currentTarget.value))}
        >
          {TABLE_PAGE_SIZES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
