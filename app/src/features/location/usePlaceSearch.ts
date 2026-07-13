import { useCallback, useEffect, useRef, useState } from 'react';
import type { Place, PlaceSuggestion } from '../../api/places';
import { getPlaceCoordinates, searchPlaces } from '../../api/places';
import type { LocationConfig } from './types';

export type RegionView =
  | { view: 'summary' }
  // Also covers city-mode's post-pick coordinate resolve (Place Details) —
  // ponytail: collapsed into the same variant as the autocomplete-search
  // loading state since nothing renders or asserts on them differently
  // (LocationScreen shows the same 3 skeleton rows for both).
  | { view: 'loading' }
  | { view: 'suggestions'; items: PlaceSuggestion[] }
  | { view: 'empty' }
  | { view: 'error'; message: string };

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

type LastAction = { type: 'search'; query: string } | { type: 'pick'; item: PlaceSuggestion };

type UsePlaceSearch = {
  query: string;
  setQuery: (value: string) => void;
  region: RegionView;
  /** The confirmable place — the config default until a search resolves a new one. */
  selected: Place;
  pick: (item: PlaceSuggestion) => void;
  /** Re-runs whichever action (search or coordinate resolve) last failed. */
  retry: () => void;
};

// Encapsulates T4's Location screen search flow: debounced autocomplete,
// stale-response guarding, and (city mode only) resolving a pick to
// coordinates — so LocationScreen only needs to render off `region`/`selected`.
export function usePlaceSearch(config: LocationConfig): UsePlaceSearch {
  const [queryText, setQueryText] = useState('');
  const [region, setRegion] = useState<RegionView>({ view: 'summary' });
  const [selected, setSelected] = useState<Place>(config.defaultPlace);
  const requestId = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAction = useRef<LastAction | null>(null);

  // Clears any pending debounce timer on unmount only — no setState here.
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const runSearch = useCallback(
    async (q: string) => {
      const id = ++requestId.current;
      const result = await searchPlaces(q, config.mode);
      if (id !== requestId.current) return; // a newer query already superseded this one
      if (result.status === 'error') {
        setRegion({ view: 'error', message: result.message });
        return;
      }
      setRegion(result.suggestions.length === 0 ? { view: 'empty' } : { view: 'suggestions', items: result.suggestions });
    },
    [config.mode]
  );

  // Fires from the TextInput's onChangeText — an event handler, not an
  // effect, so the debounce/reset-to-summary logic can setState directly.
  const setQuery = useCallback(
    (next: string) => {
      setQueryText(next);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);

      const trimmed = next.trim();
      if (trimmed.length < MIN_QUERY_LENGTH) {
        // Below the trigger length: summary card stays, no keystroke-level
        // error (Forms rule).
        setRegion({ view: 'summary' });
        return;
      }

      setRegion({ view: 'loading' });
      lastAction.current = { type: 'search', query: trimmed };
      debounceTimer.current = setTimeout(() => runSearch(trimmed), DEBOUNCE_MS);
    },
    [runSearch]
  );

  const pick = useCallback(
    async (item: PlaceSuggestion) => {
      if (config.mode === 'country') {
        // The suggestion already carries the country name — no details
        // lookup needed.
        setSelected({ name: item.primaryText, region: item.secondaryText || undefined });
        setQueryText('');
        setRegion({ view: 'summary' });
        return;
      }

      lastAction.current = { type: 'pick', item };
      const id = ++requestId.current;
      setRegion({ view: 'loading' });
      const result = await getPlaceCoordinates(item);
      if (id !== requestId.current) return;
      if (result.status === 'error') {
        // Previous selection is kept — no half-selected state.
        setRegion({ view: 'error', message: result.message });
        return;
      }
      setSelected(result.place);
      setQueryText('');
      setRegion({ view: 'summary' });
    },
    [config.mode]
  );

  const retry = useCallback(() => {
    const action = lastAction.current;
    if (!action) return;
    if (action.type === 'search') runSearch(action.query);
    else pick(action.item);
  }, [runSearch, pick]);

  return { query: queryText, setQuery, region, selected, pick, retry };
}
