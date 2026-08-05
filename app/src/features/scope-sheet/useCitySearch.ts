import { useEffect, useState } from 'react';
import type { CitySuggestion } from '../../api/cities';
import { suggestCities } from '../../api/cities';
import type { CityFetchState } from './scopeDraft';
import { cityKey } from './scopeDraft';

// Same debounce window AnywhereSearchScreen/NearbySearchSetupScreen already
// use for their live-count re-queries and city typeahead.
const DEBOUNCE_MS = 300;

// City typeahead — debounced, excludes already-selected cities. Copied
// from AnywhereSearchScreen's identical effect (design-spec.md T2: reuse
// its city-search code verbatim).
export function useCitySearch(cityQuery: string, selectedCities: CitySuggestion[]): CityFetchState {
  const [cityFetch, setCityFetch] = useState<CityFetchState>({ query: '', status: 'no-match', results: [], error: null });

  useEffect(() => {
    const query = cityQuery.trim();
    if (query.length === 0) return;
    const timer = setTimeout(() => {
      suggestCities(query).then((result) => {
        if (result.status !== 'success') {
          setCityFetch({ query, status: 'error', results: [], error: result.message });
          return;
        }
        const selectedKeys = new Set(selectedCities.map(cityKey));
        const suggestions = result.suggestions.filter((s) => !selectedKeys.has(cityKey(s)));
        setCityFetch({ query, status: suggestions.length === 0 ? 'no-match' : 'results', results: suggestions, error: null });
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [cityQuery, selectedCities]);

  return cityFetch;
}
