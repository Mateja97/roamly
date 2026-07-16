import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

// ponytail: a plain window of up-to-5 numbered pages around the current
// one, no first/last quick-jump or ellipsis — Prev/Next already reach any
// page, and this admin tool's catalog (hundreds of rows) never produces a
// page count large enough for that gap to matter in practice.
const WINDOW = 2;

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const pages: number[] = [];
  for (
    let p = Math.max(1, page - WINDOW);
    p <= Math.min(totalPages, page + WINDOW);
    p++
  ) {
    pages.push(p);
  }

  return (
    <nav className="admin-pagination" aria-label="Pagination">
      <span className="admin-pagination-summary">
        Showing {start}–{end} of {total}
      </span>
      <div className="admin-pagination-controls">
        <button
          type="button"
          className="admin-page-button"
          aria-label="Previous page"
          disabled={page <= 1}
          aria-disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            className={`admin-page-button ${p === page ? 'admin-page-button-current' : ''}`}
            aria-current={p === page ? 'page' : undefined}
            onClick={() => onPageChange(p)}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          className="admin-page-button"
          aria-label="Next page"
          disabled={page >= totalPages}
          aria-disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
