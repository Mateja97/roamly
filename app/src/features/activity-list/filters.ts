import type { ActivitiesQueryRequest, Location } from '../../api/activities';
import type { Category, Filters, RatingOption } from './types';
import type { ScopeSelection } from '../scope-picker/types';

// T3: continuous slider range, 1km up to today's fixed-chip ceiling.
export const MIN_DISTANCE_KM = 1;
export const MAX_DISTANCE_KM = 50;

export const EMPTY_FILTERS: Filters = {
  categories: [],
  minRating: null,
  maxDistanceKm: MAX_DISTANCE_KM,
};

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

export function activeFilterCount(filters: Filters): number {
  return (
    filters.categories.length +
    (filters.minRating !== null ? 1 : 0) +
    (filters.maxDistanceKm < MAX_DISTANCE_KM ? 1 : 0)
  );
}

export type FilterChipData = { key: string; label: string; remove: () => Filters };

// One removable chip per active filter value — categories get one chip each,
// the other groups (single-select) get at most one.
export function filterChips(filters: Filters): FilterChipData[] {
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
  // Only a narrowing (< the widest/default) counts as an active, removable
  // filter — mirrors the old "Any = no chip" semantics for the continuous
  // control (see design-spec.md's T3 section).
  if (filters.maxDistanceKm < MAX_DISTANCE_KM) {
    chips.push({
      key: 'max-distance',
      label: `≤ ${filters.maxDistanceKm} km`,
      remove: () => ({ ...filters, maxDistanceKm: MAX_DISTANCE_KM }),
    });
  }

  return chips;
}

// Builds the T2 proxy request body from the current scope/coordinates plus
// the applied filters. `max_distance_km` only applies to home/nearby per T2's
// contract (an error if sent with outside_country), so it's omitted there —
// including at the slider's default/ceiling value, which reproduces today's
// widest breadth rather than actually narrowing anything.
// `home_location`/`home_country` come from the place confirmed via T4's
// Location screen (App.tsx populates them before reaching this screen) —
// no hardcoded fallback here anymore.
export function buildActivitiesRequest(selection: ScopeSelection, filters: Filters): ActivitiesQueryRequest {
  const request: ActivitiesQueryRequest = { scope: selection.scope };

  if (selection.scope === 'nearby' && selection.coordinates) {
    request.current_location = toLocation(selection.coordinates);
  } else if (selection.scope === 'home' && selection.homeLocation) {
    request.home_location = selection.homeLocation;
  } else if (selection.scope === 'outside_country' && selection.homeCountry) {
    request.home_country = selection.homeCountry;
    // T5's rating-descending ranking — requested only for outside_country;
    // the server rejects it for home/nearby, and results render server-order
    // with no client re-sort (T6 out of scope).
    request.sort = 'top_rated';
  }

  if (filters.categories.length > 0) request.categories = filters.categories;
  if (filters.minRating !== null) request.min_rating = filters.minRating;
  if (selection.scope !== 'outside_country') {
    request.max_distance_km = filters.maxDistanceKm;
  }

  return request;
}

function toLocation(coordinates: { latitude: number; longitude: number }): Location {
  return { lat: coordinates.latitude, lng: coordinates.longitude };
}

export const SCOPE_TITLES: Record<ScopeSelection['scope'], string> = {
  home: 'Home',
  nearby: 'Nearby',
  outside_country: 'Outside country',
};
