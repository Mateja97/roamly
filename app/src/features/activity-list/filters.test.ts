import {
  SUBCATEGORIES,
  buildFeedRequest,
  clearCategories,
  defaultFilters,
  filterBySubtypes,
  subtypeCounts,
  toggleCategory,
} from './filters';
import type { Activity } from '../../api/activities';
import { defaultScopeDraft } from '../scope-sheet/scopeDraft';
import type { ScopeDraft } from '../scope-sheet/scopeDraft';
import type { Filters } from './types';

describe('defaultFilters', () => {
  it('nearby\'s default has no distance value — its range is server-fixed, not user-adjustable', () => {
    expect(defaultFilters('nearby')).toEqual({ categories: [], subtypes: [], minRating: null, maxDistanceKm: null });
  });

  it('anywhere\'s default is "no limit" (null)', () => {
    expect(defaultFilters('anywhere')).toEqual({ categories: [], subtypes: [], minRating: null, maxDistanceKm: null });
  });
});

describe('SUBCATEGORIES', () => {
  it('has a non-empty subtype list for every category, including tours_experiences', () => {
    expect(SUBCATEGORIES.tours_experiences.length).toBeGreaterThan(0);
    expect(SUBCATEGORIES.tours_experiences).toContainEqual({ value: 'walking_tour', label: 'Walking Tour' });
  });
});

function city(cityName: string, lat = 0, lng = 0) {
  return { city: cityName, country: 'X', centroid: { lat, lng } };
}

function draft(overrides: Partial<ScopeDraft> = {}): ScopeDraft {
  return { ...defaultScopeDraft('nearby'), ...overrides };
}

describe('buildFeedRequest', () => {
  it('never includes max_distance_km for nearby — the server always enforces its own fixed radius', () => {
    const req = buildFeedRequest(draft({ scope: 'nearby', coordinates: { latitude: 1, longitude: 2 } }), []);
    expect(req).toEqual({ scope: 'nearby', current_location: { lat: 1, lng: 2 } });
    expect(req.max_distance_km).toBeUndefined();
  });

  it('never includes max_distance_km for nearby even if somehow narrowed', () => {
    const req = buildFeedRequest(
      draft({ scope: 'nearby', coordinates: { latitude: 1, longitude: 2 }, maxDistanceKm: 25 }),
      []
    );
    expect(req.max_distance_km).toBeUndefined();
  });

  it('sends current_location for anywhere when a device-location anchor was resolved', () => {
    const req = buildFeedRequest(draft({ scope: 'anywhere', coordinates: { latitude: 1, longitude: 2 } }), []);
    expect(req).toEqual({ scope: 'anywhere', current_location: { lat: 1, lng: 2 } });
  });

  it('sends cities (not current_location) once a city is selected, even alongside a device anchor', () => {
    const req = buildFeedRequest(
      draft({ scope: 'anywhere', coordinates: { latitude: 1, longitude: 2 }, cities: [city('Lisbon', 38.7, -9.1)] }),
      []
    );
    expect(req).toEqual({ scope: 'anywhere', cities: [{ lat: 38.7, lng: -9.1 }] });
  });

  it('omits current_location and max_distance_km for anywhere with no anchor', () => {
    const req = buildFeedRequest(draft({ scope: 'anywhere' }), []);
    expect(req).toEqual({ scope: 'anywhere' });
  });

  it('sends max_distance_km for anywhere only when narrowed below "no limit", and only with an anchor', () => {
    const req = buildFeedRequest(
      draft({ scope: 'anywhere', coordinates: { latitude: 1, longitude: 2 }, maxDistanceKm: 100 }),
      []
    );
    expect(req.max_distance_km).toBe(100);

    const noAnchor = buildFeedRequest(draft({ scope: 'anywhere', maxDistanceKm: 100 }), []);
    expect(noAnchor.max_distance_km).toBeUndefined();
  });

  it('includes categories and min_rating when set, never subcategories (client-filtered instead)', () => {
    const req = buildFeedRequest(
      draft({ scope: 'nearby', coordinates: { latitude: 1, longitude: 2 }, minRating: 4.5 }),
      ['sport']
    );
    expect(req).toEqual({
      scope: 'nearby',
      current_location: { lat: 1, lng: 2 },
      categories: ['sport'],
      min_rating: 4.5,
    });
    expect(req.subcategories).toBeUndefined();
  });
});

describe('filterBySubtypes', () => {
  const restaurant: Activity = makeActivity('1', 'restaurants', 'fine_dining');
  const cafe: Activity = makeActivity('2', 'cafes', 'coffee_shop');
  const restaurantOther: Activity = makeActivity('3', 'restaurants', 'street_food');

  it('no subtypes selected -> passes everything through unfiltered', () => {
    const filters: Filters = { categories: [], subtypes: [], minRating: null, maxDistanceKm: null };
    expect(filterBySubtypes([restaurant, cafe], filters)).toEqual([restaurant, cafe]);
  });

  it('a subtype selected in one category only narrows that category, leaves other categories untouched', () => {
    const filters: Filters = { categories: ['restaurants'], subtypes: ['fine_dining'], minRating: null, maxDistanceKm: null };
    expect(filterBySubtypes([restaurant, cafe, restaurantOther], filters)).toEqual([restaurant, cafe]);
  });

  it('OR within a category — either selected subtype passes', () => {
    const filters: Filters = {
      categories: ['restaurants'],
      subtypes: ['fine_dining', 'street_food'],
      minRating: null,
      maxDistanceKm: null,
    };
    expect(filterBySubtypes([restaurant, restaurantOther], filters)).toEqual([restaurant, restaurantOther]);
  });
});

describe('subtypeCounts', () => {
  it('tallies activities by subcategory within the given category, zero for subtypes with no matches', () => {
    const activities = [
      makeActivity('1', 'restaurants', 'fine_dining'),
      makeActivity('2', 'restaurants', 'fine_dining'),
      makeActivity('3', 'restaurants', 'street_food'),
      makeActivity('4', 'cafes', 'coffee_shop'),
    ];
    const counts = subtypeCounts(activities, 'restaurants');
    expect(counts.fine_dining).toBe(2);
    expect(counts.street_food).toBe(1);
    expect(counts.casual_dining).toBe(0);
    expect(counts.fast_casual).toBe(0);
    expect(counts.bakery_dessert).toBe(0);
  });

  it('ignores activities from a different category entirely', () => {
    const counts = subtypeCounts([makeActivity('1', 'cafes', 'coffee_shop')], 'restaurants');
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
  });
});

function makeActivity(id: string, category: Activity['category'], subcategory?: string): Activity {
  return {
    id,
    title: `Activity ${id}`,
    description: '',
    category,
    location: { lat: 0, lng: 0 },
    country: 'X',
    rating: 4.5,
    image_refs: [],
    tags: [],
    distance_km: 0,
    subcategory,
  };
}

describe('toggleCategory (T4)', () => {
  it('adds an unselected category, leaving its subtypes untouched', () => {
    const filters: Filters = { categories: [], subtypes: [], minRating: null, maxDistanceKm: null };
    expect(toggleCategory(filters, 'sport')).toEqual({
      categories: ['sport'],
      subtypes: [],
      minRating: null,
      maxDistanceKm: null,
    });
  });

  it('removing a selected category drops only that category\'s own subtypes', () => {
    const filters: Filters = {
      categories: ['sport', 'culture'],
      subtypes: ['climbing_gym', 'historical_site'],
      minRating: null,
      maxDistanceKm: null,
    };
    expect(toggleCategory(filters, 'sport')).toEqual({
      categories: ['culture'],
      subtypes: ['historical_site'],
      minRating: null,
      maxDistanceKm: null,
    });
  });

  it('adding a second category leaves the first category and its subtypes intact', () => {
    const filters: Filters = {
      categories: ['sport'],
      subtypes: ['climbing_gym'],
      minRating: null,
      maxDistanceKm: null,
    };
    expect(toggleCategory(filters, 'culture')).toEqual({
      categories: ['sport', 'culture'],
      subtypes: ['climbing_gym'],
      minRating: null,
      maxDistanceKm: null,
    });
  });
});

describe('clearCategories (T4)', () => {
  it('clears every category and subtype', () => {
    const filters: Filters = {
      categories: ['sport', 'culture'],
      subtypes: ['climbing_gym', 'historical_site'],
      minRating: 4.5,
      maxDistanceKm: null,
    };
    expect(clearCategories(filters)).toEqual({
      categories: [],
      subtypes: [],
      minRating: 4.5,
      maxDistanceKm: null,
    });
  });
});
