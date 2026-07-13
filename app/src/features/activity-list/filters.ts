import type { ActivitiesQueryRequest, Location } from '../../api/activities';
import { HOME_COUNTRY, HOME_LOCATION } from './config';
import type { Category, DistanceOption, Filters, RatingOption } from './types';
import type { ScopeSelection } from '../scope-picker/types';

export const EMPTY_FILTERS: Filters = {
  categories: [],
  minRating: null,
  maxDistanceKm: null,
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

export const DISTANCE_OPTIONS: { value: DistanceOption | null; label: string }[] = [
  { value: null, label: 'Any' },
  { value: 10, label: '≤ 10 km' },
  { value: 25, label: '≤ 25 km' },
  { value: 50, label: '≤ 50 km' },
];

export function activeFilterCount(filters: Filters): number {
  return (
    filters.categories.length + (filters.minRating !== null ? 1 : 0) + (filters.maxDistanceKm !== null ? 1 : 0)
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
  if (filters.maxDistanceKm !== null) {
    chips.push({
      key: 'max-distance',
      label: `≤ ${filters.maxDistanceKm} km`,
      remove: () => ({ ...filters, maxDistanceKm: null }),
    });
  }

  return chips;
}

// Builds the T2 proxy request body from the current scope/coordinates plus
// the applied filters. `max_distance_km` only applies to home/nearby per T2's
// contract (an error if sent with outside_country), so it's omitted there.
export function buildActivitiesRequest(selection: ScopeSelection, filters: Filters): ActivitiesQueryRequest {
  const request: ActivitiesQueryRequest = { scope: selection.scope };

  if (selection.scope === 'nearby' && selection.coordinates) {
    request.current_location = toLocation(selection.coordinates);
  } else if (selection.scope === 'home') {
    request.home_location = HOME_LOCATION;
  } else if (selection.scope === 'outside_country') {
    request.home_country = HOME_COUNTRY;
  }

  if (filters.categories.length > 0) request.categories = filters.categories;
  if (filters.minRating !== null) request.min_rating = filters.minRating;
  if (filters.maxDistanceKm !== null && selection.scope !== 'outside_country') {
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
