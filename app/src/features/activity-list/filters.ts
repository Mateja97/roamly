import type { ActivitiesQueryRequest, Location } from '../../api/activities';
import type { CitySuggestion } from '../../api/cities';
import type { Category, Filters, RatingOption } from './types';
import type { Scope, ScopeSelection } from '../scope-picker/types';

// T2: Nearby's server-fixed radius (activities-service's activity.go) — the
// one copy of the number; NearbySearchSetupScreen's range card and
// ActivityListScreen's header subtitle both read it from here.
export const NEARBY_RADIUS_KM = 10;

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

// `maxDistanceKm: null` means "no limit"/"not adjustable". Nearby's range is
// server-fixed (see NearbySearchSetupScreen's buildRequest) and has no
// slider or chip at all, so it's always null, same as anywhere's "no limit"
// default — a filter's first load never narrows results the user hasn't
// asked to narrow (Slider recipe's "pinned at max" rule).
// `scope` param kept for call-site clarity (defaultFilters('nearby') vs
// ('anywhere')) even though both scopes share this default value now.
export function defaultFilters(_scope: Scope): Filters {
  return {
    categories: [],
    minRating: null,
    maxDistanceKm: null,
  };
}

// Kept for existing nearby-shaped callers/tests — equivalent to
// defaultFilters('nearby').
export const EMPTY_FILTERS: Filters = defaultFilters('nearby');

export const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: 'restaurants', label: 'Restaurants' },
  { value: 'cafes', label: 'Cafés' },
  { value: 'bars', label: 'Bars' },
  { value: 'nightlife', label: 'Nightlife' },
  { value: 'nature', label: 'Nature' },
  { value: 'sport', label: 'Sport' },
  { value: 'kids', label: 'Kids' },
  { value: 'culture', label: 'Culture' },
  { value: 'art', label: 'Art' },
  { value: 'wellness', label: 'Wellness' },
  { value: 'shopping', label: 'Shopping' },
  { value: 'entertainment', label: 'Entertainment' },
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

// Nearby has no adjustable distance control at all — never count/surface it
// as an active filter for that scope, regardless of the stored value.
function isDistanceActive(filters: Filters, scope: Scope): boolean {
  return scope === 'anywhere' && filters.maxDistanceKm !== widestDistanceKm(scope);
}

export function activeFilterCount(filters: Filters, scope: Scope): number {
  return (
    filters.categories.length +
    (filters.minRating !== null ? 1 : 0) +
    (isDistanceActive(filters, scope) ? 1 : 0)
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
  // Only a narrowing (away from the scope's widest/default), and only for
  // anywhere (nearby has no adjustable distance at all), counts as an
  // active, removable filter.
  if (isDistanceActive(filters, scope)) {
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
// granted, for anywhere). `max_distance_km` is never sent for nearby — the
// server always enforces its own fixed 10km radius and ignores the field
// (see activities-service's activity.go), so sending it only implies a
// control that doesn't exist, per NearbySearchSetupScreen's buildRequest.
// For anywhere it's sent only when the user narrowed below the "no limit"
// top stop AND an anchor exists — sending it without an anchor is a
// contract violation T1 rejects.
export function buildActivitiesRequest(selection: ScopeSelection, filters: Filters): ActivitiesQueryRequest {
  const request: ActivitiesQueryRequest = { scope: selection.scope };

  if (selection.coordinates) {
    request.current_location = toLocation(selection.coordinates);
  }

  if (filters.categories.length > 0) request.categories = filters.categories;
  if (filters.minRating !== null) request.min_rating = filters.minRating;

  if (selection.scope === 'anywhere' && selection.coordinates && filters.maxDistanceKm !== null) {
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

function activityCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'activity' : 'activities'}`;
}

// "Lisbon" / "Lisbon & Barcelona" / "Lisbon, Barcelona & Amsterdam" — comma
// join with "&" before the last item, no Oxford comma. Empty input returns
// '' (callers only reach for this once they know cities.length > 0).
export function citiesJoinLabel(cities: CitySuggestion[]): string {
  const names = cities.map((c) => c.city);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

// Composite Page-header subtitle (design-spec.md T2). `null` means
// "title-only header" — Anywhere's zero-city fallback (current_location
// anchor, no city list to show).
export function headerSubtitle(scope: Scope, count: number, cities: CitySuggestion[]): string | null {
  const countLabel = activityCountLabel(count);
  if (scope === 'nearby') return `${countLabel} · within ${NEARBY_RADIUS_KM} km`;
  if (cities.length === 0) return null;
  return `${countLabel} · ${citiesJoinLabel(cities)}`;
}
