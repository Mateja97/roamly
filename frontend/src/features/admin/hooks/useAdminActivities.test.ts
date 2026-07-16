import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAdminActivities } from './useAdminActivities';
import { listAdminActivities } from '../../../api/adminActivities';

vi.mock('../../../api/adminActivities', () => ({
  listAdminActivities: vi.fn(),
}));

const mockedList = vi.mocked(listAdminActivities);

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
    renderHook(() => useAdminActivities());
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mockedList).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, page_size: 20 }),
    );
  });

  it('debounces search — no request fired per keystroke', async () => {
    const { result } = renderHook(() => useAdminActivities());
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
    const { result } = renderHook(() => useAdminActivities());
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
    const { result } = renderHook(() => useAdminActivities());
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
    const { result } = renderHook(() => useAdminActivities());
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current.result).toEqual({
      status: 403,
      message: 'invalid or missing admin token',
    });
  });
});
