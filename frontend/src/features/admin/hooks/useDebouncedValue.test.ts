import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not update immediately when the input value changes', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      {
        initialProps: { value: 'a' },
      },
    );

    rerender({ value: 'ab' });
    expect(result.current).toBe('a');
  });

  it('settles to the latest value once the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      {
        initialProps: { value: 'a' },
      },
    );

    rerender({ value: 'ab' });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('ab');
  });

  it('resets the timer on every intermediate change (no fire per keystroke)', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      {
        initialProps: { value: 'a' },
      },
    );

    rerender({ value: 'ab' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ value: 'abc' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // 400ms of real time has passed, but each keystroke reset the 300ms
    // timer, so it should not have settled yet.
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('abc');
  });
});
