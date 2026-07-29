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
    subtypes: [],
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
  { value: 'tours_experiences', label: 'Tours & Experiences' },
];

export const CATEGORY_LABELS: Record<Category, string> = CATEGORY_OPTIONS.reduce(
  (acc, { value, label }) => ({ ...acc, [value]: label }),
  {} as Record<Category, string>
);

// design-spec.md T1: the activities-list header's quick-filter row —
// `All` plus these headline categories, per frame `5a`'s `All / Restaurants
// / Bars / Culture`. Same headline set for both scopes (the mock only shows
// one); the sheet's full category list remains the source of truth for
// anything beyond this shortcut row.
export const HEADLINE_CATEGORIES: Category[] = ['restaurants', 'bars', 'culture'];

// The quick-filter row is a projection of the sheet's own (multi-select)
// category filter, not separate state. Exactly one chip reads as active: a
// headline category when the applied filters hold exactly that one
// category, `All` otherwise (0 or 2+ categories, or a non-headline
// category) — the accepted resting behavior per design-spec.md T1, not a bug.
export function activeQuickFilterCategory(filters: Filters): Category | null {
  if (filters.categories.length !== 1) return null;
  const [category] = filters.categories;
  return HEADLINE_CATEGORIES.includes(category) ? category : null;
}

// Next Filters when a quick-filter chip is tapped: `null` (All) clears the
// category filter; a headline category becomes the sole selected category.
// Subtypes always reset — they're scoped to the sheet's own category
// selection, which this shortcut row bypasses (same orphan-clearing intent
// as FilterSheet's category checkbox handler).
export function applyQuickFilterCategory(filters: Filters, category: Category | null): Filters {
  return { ...filters, categories: category ? [category] : [], subtypes: [] };
}

// T3: category -> subtype options, the same 59-slug taxonomy from
// BUSINESS_STANDARDS.md's subcategory table as the web frontend's
// `SUBCATEGORIES` (frontend/src/features/admin/constants.ts) and the T1 wire
// contract's `subcategories` field — one source of truth per surface (app has
// no shared package with frontend), kept in lockstep by hand since both are
// small, static, and rarely change.
export const SUBCATEGORIES: Record<Category, { value: string; label: string }[]> = {
  restaurants: [
    { value: 'fine_dining', label: 'Fine Dining' },
    { value: 'casual_dining', label: 'Casual Dining' },
    { value: 'fast_casual', label: 'Fast Casual' },
    { value: 'street_food', label: 'Food Truck/Street Food' },
    { value: 'bakery_dessert', label: 'Bakery & Dessert' },
  ],
  cafes: [
    { value: 'coffee_shop', label: 'Coffee Shop' },
    { value: 'tea_house', label: 'Tea House' },
    { value: 'bakery_cafe', label: 'Bakery Cafe' },
  ],
  bars: [
    { value: 'cocktail_bar', label: 'Cocktail Bar' },
    { value: 'wine_bar', label: 'Wine Bar' },
    { value: 'brewery', label: 'Brewery/Beer Garden' },
    { value: 'sports_bar', label: 'Sports Bar' },
    { value: 'pub', label: 'Pub' },
  ],
  nightlife: [
    { value: 'nightclub', label: 'Nightclub' },
    { value: 'live_music_venue', label: 'Live Music Venue' },
    { value: 'lounge', label: 'Lounge' },
  ],
  nature: [
    { value: 'hiking_trail', label: 'Hiking Trail' },
    { value: 'park', label: 'Park' },
    { value: 'beach', label: 'Beach' },
    { value: 'botanical_garden', label: 'Garden/Botanical' },
    { value: 'viewpoint', label: 'Viewpoint/Lookout' },
  ],
  sport: [
    { value: 'gym_fitness', label: 'Gym/Fitness Studio' },
    { value: 'climbing_gym', label: 'Climbing Gym' },
    { value: 'swimming_pool', label: 'Swimming Pool' },
    { value: 'sports_court', label: 'Sports Court/Field' },
    { value: 'golf_course', label: 'Golf Course' },
    { value: 'extreme_sports', label: 'Adventure/Extreme Sports' },
  ],
  kids: [
    { value: 'playground', label: 'Playground' },
    { value: 'indoor_play_center', label: 'Indoor Play Center' },
    { value: 'zoo_aquarium', label: 'Zoo/Aquarium' },
    { value: 'amusement_park', label: 'Amusement Park' },
    { value: 'kids_museum', label: "Kids' Museum" },
  ],
  culture: [
    { value: 'historical_site', label: 'Historical Site' },
    { value: 'monument_landmark', label: 'Monument/Landmark' },
    { value: 'heritage_museum', label: 'Heritage Museum' },
    { value: 'religious_site', label: 'Religious Site' },
  ],
  art: [
    { value: 'art_gallery', label: 'Art Gallery' },
    { value: 'art_museum', label: 'Art Museum' },
    { value: 'studio_workshop', label: 'Studio/Workshop' },
    { value: 'public_art', label: 'Public Art Installation' },
  ],
  wellness: [
    { value: 'spa', label: 'Spa' },
    { value: 'yoga_studio', label: 'Yoga Studio' },
    { value: 'meditation_center', label: 'Meditation Center' },
    { value: 'thermal_bath', label: 'Hot Springs/Thermal Bath' },
  ],
  shopping: [
    { value: 'market_bazaar', label: 'Market/Bazaar' },
    { value: 'boutique', label: 'Boutique' },
    { value: 'mall', label: 'Mall' },
    { value: 'specialty_store', label: 'Specialty Store' },
  ],
  entertainment: [
    { value: 'cinema', label: 'Cinema' },
    { value: 'escape_room', label: 'Escape Room' },
    { value: 'bowling_arcade', label: 'Bowling/Arcade' },
    { value: 'theater', label: 'Theater/Performance' },
    { value: 'casino', label: 'Casino' },
  ],
  tours_experiences: [
    { value: 'walking_tour', label: 'Walking Tour' },
    { value: 'day_trip', label: 'Day Trip' },
    { value: 'food_drink_tour', label: 'Food & Drink Tour' },
    { value: 'adventure_tour', label: 'Adventure Tour' },
    { value: 'cooking_class', label: 'Cooking Class/Workshop' },
    { value: 'bike_tour', label: 'Bike Tour' },
  ],
};

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

// One removable chip per active non-category filter value (rating,
// distance) — each single-select group gets at most one. design-spec.md T1:
// category filters no longer get a removable chip here — they're
// represented by the header's quick-filter row highlight instead (see
// activeQuickFilterCategory), so showing both would duplicate the same
// state. The sheet remains the full control for categories either way.
export function filterChips(filters: Filters, scope: Scope): FilterChipData[] {
  const chips: FilterChipData[] = [];

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
  // Only meaningful (and only ever populated) alongside exactly one selected
  // category — see FilterSheet's orphan-clearing — but sent as-is here since
  // by request-build time that invariant already holds.
  if (filters.subtypes.length > 0) request.subcategories = filters.subtypes;
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

// design-spec.md T1: copy change to match frame `5a` — "activities" → "places".
function placeCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'place' : 'places'}`;
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
  const countLabel = placeCountLabel(count);
  if (scope === 'nearby') return `${countLabel} · within ${NEARBY_RADIUS_KM} km`;
  if (cities.length === 0) return null;
  return `${countLabel} · ${citiesJoinLabel(cities)}`;
}
