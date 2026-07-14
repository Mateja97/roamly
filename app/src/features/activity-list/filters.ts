import type { ActivitiesQueryRequest, Location } from '../../api/activities';
import type { Category, Filters, RatingOption } from './types';
import type { Scope, ScopeSelection } from '../scope-picker/types';

// Nearby's continuous slider range — unchanged by T2.
export const MIN_DISTANCE_KM = 1;
export const MAX_DISTANCE_KM = 50;

// Anywhere's wider, design-tuned range (product-tasks.md: "behavior is
// fixed, not the exact numbers"). The slider's true top position is one
// step past MAX_DISTANCE_KM_ANYWHERE — a dedicated "No limit" stop, not
// itself a distance value — see ANYWHERE_NO_LIMIT_SLIDER_VALUE below.
export const MIN_DISTANCE_KM_ANYWHERE = 100;
export const MAX_DISTANCE_KM_ANYWHERE = 2000;
export const ANYWHERE_DISTANCE_STEP_KM = 100;
// Slider-control-only sentinel (never sent to the API): the position past
// the numeric ceiling that maps to Filters.maxDistanceKm = null ("no limit").
export const ANYWHERE_NO_LIMIT_SLIDER_VALUE = MAX_DISTANCE_KM_ANYWHERE + ANYWHERE_DISTANCE_STEP_KM;

// `maxDistanceKm: null` means "no limit" — only reachable for `anywhere`
// (Nearby's slider has no such stop, always a 1-50 number). Widest/default
// per scope, so a filter's first load never narrows results the user
// hasn't asked to narrow (Slider recipe's "pinned at max" rule).
export function defaultFilters(scope: Scope): Filters {
  return {
    categories: [],
    minRating: null,
    maxDistanceKm: scope === 'nearby' ? MAX_DISTANCE_KM : null,
  };
}

// Kept for existing nearby-shaped callers/tests — equivalent to
// defaultFilters('nearby').
export const EMPTY_FILTERS: Filters = defaultFilters('nearby');

export const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: 'food_and_drink', label: 'Food & Drink' },
  { value: 'history_and_culture', label: 'History & Culture' },
  { value: 'nature_and_outdoors', label: 'Nature & Outdoors' },
  { value: 'art_and_design', label: 'Art & Design' },
  { value: 'sports', label: 'Sports' },
  { value: 'entertainment_and_wellness', label: 'Entertainment & Wellness' },
];

export const CATEGORY_LABELS: Record<Category, string> = CATEGORY_OPTIONS.reduce(
  (acc, { value, label }) => ({ ...acc, [value]: label }),
  {} as Record<Category, string>
);

export const RATING_OPTIONS: { value: RatingOption | null; label: string }[] = [
  { value: null, label: 'Any' },
  { value: 4.0, label: '4.0+' },
  { value: 4.5, label: '4.5+' },
  { value: 4.8, label: '4.8+' },
];

// A scope's "widest" distance value — the same value defaultFilters uses —
// is what "narrowed" is measured against, and what removing the distance
// chip resets back to.
function widestDistanceKm(scope: Scope): number | null {
  return defaultFilters(scope).maxDistanceKm;
}

export function activeFilterCount(filters: Filters, scope: Scope): number {
  return (
    filters.categories.length +
    (filters.minRating !== null ? 1 : 0) +
    (filters.maxDistanceKm !== widestDistanceKm(scope) ? 1 : 0)
  );
}

export type FilterChipData = { key: string; label: string; remove: () => Filters };

// One removable chip per active filter value — categories get one chip each,
// the other groups (single-select) get at most one.
export function filterChips(filters: Filters, scope: Scope): FilterChipData[] {
  const chips: FilterChipData[] = filters.categories.map((category) => ({
    key: `category:${category}`,
    label: CATEGORY_LABELS[category],
    remove: () => ({ ...filters, categories: filters.categories.filter((c) => c !== category) }),
  }));

  if (filters.minRating !== null) {
    chips.push({
      key: 'min-rating',
      label: `${filters.minRating.toFixed(1)}+`,
      remove: () => ({ ...filters, minRating: null }),
    });
  }
  // Only a narrowing (away from the scope's widest/default) counts as an
  // active, removable filter.
  if (filters.maxDistanceKm !== widestDistanceKm(scope)) {
    chips.push({
      key: 'max-distance',
      label: `≤ ${filters.maxDistanceKm} km`,
      remove: () => ({ ...filters, maxDistanceKm: widestDistanceKm(scope) }),
    });
  }

  return chips;
}

// Builds the proxy request body from the current scope/coordinates plus the
// applied filters. `current_location` travels for either scope whenever a
// device-location anchor was resolved (always for nearby; only when
// granted, for anywhere). `max_distance_km` is sent for nearby unconditionally
// (its slider always has a numeric value), and for anywhere only when the
// user narrowed below the "no limit" top stop AND an anchor exists — sending
// it without an anchor is a contract violation T1 rejects.
export function buildActivitiesRequest(selection: ScopeSelection, filters: Filters): ActivitiesQueryRequest {
  const request: ActivitiesQueryRequest = { scope: selection.scope };

  if (selection.coordinates) {
    request.current_location = toLocation(selection.coordinates);
  }

  if (filters.categories.length > 0) request.categories = filters.categories;
  if (filters.minRating !== null) request.min_rating = filters.minRating;

  if (selection.scope === 'nearby') {
    request.max_distance_km = filters.maxDistanceKm ?? MAX_DISTANCE_KM;
  } else if (selection.coordinates && filters.maxDistanceKm !== null) {
    request.max_distance_km = filters.maxDistanceKm;
  }

  return request;
}

function toLocation(coordinates: { latitude: number; longitude: number }): Location {
  return { lat: coordinates.latitude, lng: coordinates.longitude };
}

export const SCOPE_TITLES: Record<Scope, string> = {
  nearby: 'Nearby',
  anywhere: 'Anywhere',
};
