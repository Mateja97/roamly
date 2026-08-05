import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAdminActivities } from './useAdminActivities';
import { listAdminActivities } from '../../../api/adminActivities';

vi.mock('../../../api/adminActivities', () => ({
  listAdminActivities: vi.fn(),
}));

const mockedList = vi.mocked(listAdminActivities);

/** The hook reads and writes its filters through `useSearchParams` (added by
 * #68, "persist activity list filters across navigation"), so it only renders
 * inside a router. MemoryRouter gives it a real, writable search string rather
 * than a stub — which means the persistence half of the hook is genuinely
 * exercised here instead of mocked away. Same wrapper the sibling admin tests
 * use (AdminShell, EditActivityPage, ActivitiesPage, ...). */
function withRouter({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

/** renderHook with the router wrapper applied — every test in this file needs
 * it, so none of them should have to remember it. */
function renderAdminActivities() {
  return renderHook(() => useAdminActivities(), { wrapper: withRouter });
}

const emptyResponse = {
  status: 'success' as const,
  data: {
    activities: [],
    total: 0,
    page: 1,
    page_size: 20,
    stats: { total: 0, published: 0, draft: 0, pending: 0 },
  },
};

describe('useAdminActivities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedList.mockResolvedValue(emptyResponse);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('fetches once on mount with default params', async () => {
    renderAdminActivities();
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mockedList).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, page_size: 20 }),
    );
  });

  it('debounces search — no request fired per keystroke', async () => {
    const { result } = renderAdminActivities();
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    mockedList.mockClear();

    act(() => {
      result.current.setSearch('m');
    });
    act(() => {
      result.current.setSearch('mu');
    });
    act(() => {
      result.current.setSearch('mus');
    });
    // Not yet settled — no fetch caused by keystrokes.
    expect(mockedList).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(mockedList).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'mus', page: 1 }),
    );
  });

  it('a filter change resets to page 1 in a single request', async () => {
    const { result } = renderAdminActivities();
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    act(() => {
      result.current.setPage(3);
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    mockedList.mockClear();

    act(() => {
      result.current.setStatus('draft');
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(mockedList).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'draft', page: 1 }),
    );
  });

  it('clearFilters resets search/category/city/status/page', async () => {
    const { result } = renderAdminActivities();
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    act(() => {
      result.current.setCategory('sport');
      result.current.setCity('Belgrade');
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    act(() => {
      result.current.clearFilters();
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.category).toBe('');
    expect(result.current.city).toBe('');
    expect(result.current.page).toBe(1);
    expect(mockedList).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ category: 'sport', city: 'Belgrade' }),
    );
  });

  it('surfaces an error result branch (e.g. 403) without throwing', async () => {
    mockedList.mockResolvedValue({
      status: 403,
      message: 'invalid or missing admin token',
    });
    const { result } = renderAdminActivities();
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current.result).toEqual({
      status: 403,
      message: 'invalid or missing admin token',
    });
  });
});
