import { useEffect, useState } from 'react';
import {
  listAdminActivities,
  type AdminApiResult,
  type ListAdminActivitiesResponse,
} from '../../../api/adminActivities';
import { useDebouncedValue } from './useDebouncedValue';
import { DEFAULT_PAGE_SIZE } from '../constants';

interface FiltersState {
  search: string;
  category: string;
  city: string;
  status: string;
  page: number;
}

const EMPTY_FILTERS: FiltersState = {
  search: '',
  category: '',
  city: '',
  status: '',
  page: 1,
};

export type ActivitiesQueryState =
  { status: 'loading' } | AdminApiResult<ListAdminActivitiesResponse>;

export interface UseAdminActivities {
  /** The raw, un-debounced search box value (what the input displays). */
  search: string;
  setSearch: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  city: string;
  setCity: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  page: number;
  setPage: (page: number) => void;
  clearFilters: () => void;
  result: ActivitiesQueryState;
}

/** Owns the server-driven filter/page state for the activities list and
 * fetches on every settled change. Every setter (except `setSearch`, which
 * is debounced) folds its own value + a page reset into a single state
 * update, so a filter change produces exactly one request at page 1 —
 * never a stale page-N request followed by a page-1 one. */
export function useAdminActivities(): UseAdminActivities {
  const [rawSearch, setRawSearch] = useState('');
  const debouncedSearch = useDebouncedValue(rawSearch, 300);
  const [filters, setFilters] = useState<FiltersState>(EMPTY_FILTERS);
  const [result, setResult] = useState<ActivitiesQueryState>({
    status: 'loading',
  });

  // Only the debounced value reaches `filters`, and it resets the page in
  // the same update — this is the one point search touches `filters`.
  useEffect(() => {
    setFilters((f) => ({ ...f, search: debouncedSearch, page: 1 }));
  }, [debouncedSearch]);

  useEffect(() => {
    let cancelled = false;
    setResult({ status: 'loading' });
    listAdminActivities({
      q: filters.search || undefined,
      category: filters.category || undefined,
      city: filters.city || undefined,
      status: filters.status || undefined,
      page: filters.page,
      page_size: DEFAULT_PAGE_SIZE,
    }).then((res) => {
      if (!cancelled) setResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, [
    filters.search,
    filters.category,
    filters.city,
    filters.status,
    filters.page,
  ]);

  return {
    search: rawSearch,
    setSearch: setRawSearch,
    category: filters.category,
    setCategory: (value) =>
      setFilters((f) => ({ ...f, category: value, page: 1 })),
    city: filters.city,
    setCity: (value) => setFilters((f) => ({ ...f, city: value, page: 1 })),
    status: filters.status,
    setStatus: (value) => setFilters((f) => ({ ...f, status: value, page: 1 })),
    page: filters.page,
    setPage: (page) => setFilters((f) => ({ ...f, page })),
    clearFilters: () => {
      setRawSearch('');
      setFilters(EMPTY_FILTERS);
    },
    result,
  };
}
