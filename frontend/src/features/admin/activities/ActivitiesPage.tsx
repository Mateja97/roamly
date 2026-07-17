import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { useAdminActivities } from '../hooks/useAdminActivities';
import { listAdminCities } from '../../../api/adminActivities';
import { StatCards, type StatCardsState } from './StatCards';
import { FilterRow } from './FilterRow';
import { ActivitiesTable } from './ActivitiesTable';
import { Pagination } from './Pagination';
import './Activities.css';

function statCardsState(
  result: ReturnType<typeof useAdminActivities>['result'],
): StatCardsState {
  if (result.status === 'loading') return { kind: 'loading' };
  if (result.status === 'success')
    return { kind: 'loaded', stats: result.data.stats };
  return { kind: 'error' };
}

export function ActivitiesPage() {
  const {
    search,
    setSearch,
    category,
    setCategory,
    city,
    setCity,
    status,
    setStatus,
    setPage,
    clearFilters,
    result,
  } = useAdminActivities();

  // GET /admin/cities, once on mount — every distinct city across all
  // statuses (unlike the public typeahead in src/api/cities.ts, which is
  // published-only and needs a non-empty prefix). Best-effort: a failure
  // just leaves the dropdown at "All cities", not a page-level error.
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    listAdminCities().then((res) => {
      if (cancelled) return;
      if (res.status === 'success') setCityOptions(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keeps the pagination shell rendered through every loading transition
  // (design-spec requirement) — stale-while-loading: the last successful
  // page/total keeps showing, visually muted, while a refetch is in
  // flight, rather than the footer popping in only once the very first
  // request resolves.
  const [lastPage, setLastPage] = useState<{
    page: number;
    pageSize: number;
    total: number;
  } | null>(null);
  useEffect(() => {
    if (result.status === 'success') {
      setLastPage({
        page: result.data.page,
        pageSize: result.data.page_size,
        total: result.data.total,
      });
    }
  }, [result]);

  const isLoading = result.status === 'loading';
  // Error/403 results intentionally fall back to nothing here (not
  // `lastPage`) — the table's banner/blocking panel already owns
  // communicating the failure; stale, clickable pagination next to it
  // would be a second, inconsistent source of truth.
  const paginationData =
    result.status === 'success' && result.data.total > 0
      ? {
          page: result.data.page,
          pageSize: result.data.page_size,
          total: result.data.total,
        }
      : isLoading
        ? lastPage
        : null;

  return (
    <div className="admin-page">
      <header className="admin-top-bar">
        <div className="admin-top-bar-title">
          <h1 className="admin-page-title">Activities</h1>
          <p className="admin-page-subtitle">
            {result.status === 'success' &&
              `${result.data.stats.total} activities across ${cityOptions.length} cities`}
            {result.status === 'loading' && 'Loading catalog…'}
            {/* An error/403 result says nothing here — the table's own
                banner/blocking panel is the one place that reports the
                failure; a stale "Loading catalog…" would be misleading. */}
          </p>
        </div>
        <div className="admin-top-bar-spacer" />
        <label className="admin-search-box">
          <Search size={16} className="admin-search-icon" aria-hidden="true" />
          <input
            type="search"
            className="admin-search-input"
            placeholder="Search activities…"
            aria-label="Search activities"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <Link to="/activities/new" className="admin-primary-button">
          <Plus size={16} aria-hidden="true" />
          New activity
        </Link>
      </header>

      <StatCards state={statCardsState(result)} />

      <FilterRow
        status={status}
        onStatusChange={setStatus}
        category={category}
        onCategoryChange={setCategory}
        city={city}
        onCityChange={setCity}
        cityOptions={cityOptions}
      />

      <ActivitiesTable result={result} onClearFilters={clearFilters} />

      <div className="admin-pagination-footer">
        {paginationData && paginationData.total > 0 && (
          <Pagination
            page={paginationData.page}
            pageSize={paginationData.pageSize}
            total={paginationData.total}
            onPageChange={setPage}
            disabled={isLoading}
          />
        )}
        {!paginationData && isLoading && (
          <div className="admin-pagination-skeleton" aria-hidden="true">
            <span
              className="admin-skeleton admin-text-skeleton"
              style={{ width: '160px' }}
            />
            <div className="admin-pagination-controls">
              <span
                className="admin-skeleton"
                style={{ width: 44, height: 44, borderRadius: 'var(--radius)' }}
              />
              <span
                className="admin-skeleton"
                style={{ width: 44, height: 44, borderRadius: 'var(--radius)' }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
