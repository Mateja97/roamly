import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { useAdminActivities } from '../hooks/useAdminActivities';
import { suggestCities } from '../../../api/cities';
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

  // ponytail: no admin endpoint enumerates distinct cities (see
  // src/api/cities.ts), so this reuses the public published-only
  // typeahead once on mount, best-effort, for the city dropdown/subtitle.
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    suggestCities().then((cities) => {
      if (!cancelled) setCityOptions([...cities].sort());
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
        {result.status === 'success' && result.data.total > 0 && (
          <Pagination
            page={result.data.page}
            pageSize={result.data.page_size}
            total={result.data.total}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  );
}
