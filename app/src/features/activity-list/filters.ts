import type { Activity, ActivitiesQueryRequest, Location } from '../../api/activities';
import type { CitySuggestion } from '../../api/cities';
import type { ScopeDraft } from '../scope-sheet/scopeDraft';
import { anywhereHasAnchor } from '../scope-sheet/scopeDraft';
import type { Category, Filters, RatingOption } from './types';
import type { Scope } from '../scope-picker/types';

// T2: Nearby's server-fixed radius (activities-service's activity.go) — the
// one copy of the number; the Scope sheet's (T2) fixed-range card reads it
// from here.
export const NEARBY_RADIUS_KM = 10;

// `maxDistanceKm: null` means "no limit"/"not adjustable". Nearby's range is
// server-fixed and has no slider or chip at all, so it's always null, same
// as anywhere's "no limit" default — a filter's first load never narrows
// results the user hasn't asked to narrow (Slider recipe's "pinned at max"
// rule). T4: the old 100-2000km Anywhere range (`FilterSheet`'s
// `DistanceSlider`) is gone — the Scope sheet's `scopeDraft.ts` now owns the
// app's one canonical 5-500km range.
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

// design-spec.md T4: subtype slug -> its owning category, for orphan-
// clearing when a category pill toggles off. Slugs are globally unique
// across categories (BUSINESS_STANDARDS.md), so this reverse index is
// unambiguous.
const SUBTYPE_CATEGORY: Record<string, Category> = Object.entries(SUBCATEGORIES).reduce(
  (acc, [category, options]) => {
    for (const option of options) acc[option.value] = category as Category;
    return acc;
  },
  {} as Record<string, Category>
);

// T4: the header pill row and the sheet's own Category group both write
// straight into `filters.categories` — no separate "quick filter"
// projection. Toggling a category off drops only that category's own
// subtypes; every other category's subtypes stay untouched (the design's
// per-category orphan-clearing rule).
export function toggleCategory(filters: Filters, category: Category): Filters {
  const wasSelected = filters.categories.includes(category);
  const categories = wasSelected
    ? filters.categories.filter((c) => c !== category)
    : [...filters.categories, category];
  const subtypes = wasSelected ? filters.subtypes.filter((s) => SUBTYPE_CATEGORY[s] !== category) : filters.subtypes;
  return { ...filters, categories, subtypes };
}

// `All` clears every selected category (and, since no category remains,
// every subtype with it). Re-tapping an already-active `All` is a no-op —
// enforced by the caller (ActivityListScreen), which skips calling this at
// all when `categories` is already empty, so no redundant query fires.
export function clearCategories(filters: Filters): Filters {
  return { ...filters, categories: [], subtypes: [] };
}

export const RATING_OPTIONS: { value: RatingOption | null; label: string }[] = [
  { value: null, label: 'Any' },
  { value: 4.0, label: '4.0+' },
  { value: 4.5, label: '4.5+' },
  { value: 4.8, label: '4.8+' },
];

// "Lisbon" / "Lisbon & Barcelona" / "Lisbon, Barcelona & Amsterdam" — comma
// join with "&" before the last item, no Oxford comma. Empty input returns
// '' (callers only reach for this once they know cities.length > 0).
export function citiesJoinLabel(cities: CitySuggestion[]): string {
  const names = cities.map((c) => c.city);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

function toLocation(coordinates: { latitude: number; longitude: number }): Location {
  return { lat: coordinates.latitude, lng: coordinates.longitude };
}

// design-spec.md T3: the Feed's request builder, replacing the old
// `buildActivitiesRequest` (which took the sheet's now-retired
// categories+subtypes+minRating+maxDistanceKm `Filters` shape wholesale).
// Scope/city/distance/rating now live in T2's `ScopeDraft`; only categories
// stay on `Filters` (the Feed's own pill-row state) — `subtypes` are
// deliberately **not** sent on the wire at all: see `filterBySubtypes`
// below for why (client-side filtering off one category-scoped fetch, so
// the subtype rail's per-chip counts don't need a second round trip).
export function buildFeedRequest(draft: ScopeDraft, categories: Category[]): ActivitiesQueryRequest {
  const request: ActivitiesQueryRequest = { scope: draft.scope };

  if (draft.cities.length > 0) {
    request.cities = draft.cities.map((c) => c.centroid);
  } else if (draft.coordinates) {
    request.current_location = toLocation(draft.coordinates);
  }

  if (categories.length > 0) request.categories = categories;
  if (draft.minRating !== null) request.min_rating = draft.minRating;
  // Nearby's range is server-fixed and never sent (activities-service
  // ignores the field for that scope regardless); Anywhere only sends it
  // once an anchor exists (city or device location) and the user narrowed
  // below the "no limit" top stop.
  if (draft.scope === 'anywhere' && anywhereHasAnchor(draft) && draft.maxDistanceKm !== null) {
    request.max_distance_km = draft.maxDistanceKm;
  }

  return request;
}

// design-spec.md T3 Decision 5 / Subtype rail: "Subtypes OR within their
// category, AND across categories." Since one activity only ever belongs to
// one category, that resolves to: an activity passes if its own category
// has no subtype narrowing at all, or its subcategory is one of that
// category's selected subtypes — never affected by another category's
// subtype selection.
export function filterBySubtypes(activities: Activity[], filters: Filters): Activity[] {
  if (filters.subtypes.length === 0) return activities;
  return activities.filter((activity) => {
    const subtypesInCategory = filters.subtypes.filter((s) => SUBTYPE_CATEGORY[s] === activity.category);
    if (subtypesInCategory.length === 0) return true;
    return subtypesInCategory.includes(activity.subcategory ?? '');
  });
}

// design-spec.md T3: "Each subtype chip carries a live per-subtype result
// count and disables at zero." Counts come from the category-scoped fetch
// *before* subtype filtering (never from the already subtype-filtered
// display list) — a chip's count is "how many results have this subtype",
// independent of which other subtypes are currently checked in the same
// category, the standard facet-count reading.
export function subtypeCounts(activities: Activity[], category: Category): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const option of SUBCATEGORIES[category]) counts[option.value] = 0;
  for (const activity of activities) {
    if (activity.category !== category) continue;
    if (activity.subcategory && activity.subcategory in counts) counts[activity.subcategory] += 1;
  }
  return counts;
}
