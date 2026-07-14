import type { ActivitiesQueryRequest } from '../../api/activities';
import type { CitySuggestion } from '../../api/cities';
import type { Category } from '../activity-list/types';
import type { ScopeSelection } from '../scope-picker/types';

// design-spec.md T5: 5-500 km, default pinned at the widest/least-restrictive
// end (Slider recipe's "pinned at max, drag to tighten" default) — a filter's
// first-load value must never narrow results the user hasn't asked to narrow.
export const MIN_DISTANCE_KM = 5;
export const MAX_DISTANCE_KM = 500;
export const DEFAULT_DISTANCE_KM = 500;

export type AnywhereSearchState = {
  maxDistanceKm: number;
  cities: CitySuggestion[];
  categories: Category[];
};

export function defaultAnywhereSearchState(): AnywhereSearchState {
  return { maxDistanceKm: DEFAULT_DISTANCE_KM, cities: [], categories: [] };
}

export function isAnywhereSearchDefault(state: AnywhereSearchState): boolean {
  return state.maxDistanceKm === DEFAULT_DISTANCE_KM && state.cities.length === 0 && state.categories.length === 0;
}

// Behavior note (design-spec.md T5): 0 cities -> radius measured from the
// user's current_location (point-anchored, as today); 1+ cities -> radius
// measured from each selected city centroid (union), independent of
// current_location. Categories always apply on top, when any are selected.
export function buildAnywhereSearchRequest(
  selection: ScopeSelection,
  state: AnywhereSearchState
): ActivitiesQueryRequest {
  const request: ActivitiesQueryRequest = { scope: 'anywhere', max_distance_km: state.maxDistanceKm };

  if (state.cities.length > 0) {
    request.cities = state.cities.map((c) => c.centroid);
  } else if (selection.coordinates) {
    request.current_location = { lat: selection.coordinates.latitude, lng: selection.coordinates.longitude };
  }

  if (state.categories.length > 0) request.categories = state.categories;

  return request;
}
