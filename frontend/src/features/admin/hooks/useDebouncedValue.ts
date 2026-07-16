import { useEffect, useState } from 'react';

/** Settles to `value` after `delayMs` of no further changes. Used for the
 * search box so typing doesn't fire a request per keystroke. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
