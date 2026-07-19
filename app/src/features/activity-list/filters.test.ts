import {
  ANYWHERE_NO_LIMIT_SLIDER_VALUE,
  EMPTY_FILTERS,
  MAX_DISTANCE_KM_ANYWHERE,
  SUBCATEGORIES,
  activeFilterCount,
  buildActivitiesRequest,
  defaultFilters,
  filterChips,
} from './filters';
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

describe('activeFilterCount', () => {
  it('is 0 for the empty (nearby) filter set', () => {
    expect(activeFilterCount(EMPTY_FILTERS, 'nearby')).toBe(0);
  });

  it('is 0 for anywhere at its "no limit" default', () => {
    expect(activeFilterCount(defaultFilters('anywhere'), 'anywhere')).toBe(0);
  });

  it('counts each category plus each single-select group (nearby), distance never counted', () => {
    const filters: Filters = {
      categories: ['sport', 'restaurants'],
      subtypes: [],
      minRating: 4.5,
      maxDistanceKm: null,
    };
    expect(activeFilterCount(filters, 'nearby')).toBe(3);
  });

  it('counts a narrowed anywhere distance as an active filter', () => {
    const filters: Filters = { categories: [], subtypes: [], minRating: null, maxDistanceKm: 300 };
    expect(activeFilterCount(filters, 'anywhere')).toBe(1);
  });
});

describe('filterChips', () => {
  it('produces one chip per category and one per single-select group, no distance chip for nearby', () => {
    const filters: Filters = {
      categories: ['sport'],
      subtypes: [],
      minRating: 4.5,
      maxDistanceKm: null,
    };
    const chips = filterChips(filters, 'nearby');
    expect(chips.map((c) => c.label)).toEqual(['Sport', '4.5+']);
  });

  it('a chip.remove() clears only that one filter value', () => {
    const filters: Filters = { categories: ['sport', 'art'], subtypes: [], minRating: null, maxDistanceKm: null };
    const chips = filterChips(filters, 'nearby');
    const sportsChip = chips.find((c) => c.label === 'Sport')!;
    expect(sportsChip.remove()).toEqual({
      categories: ['art'],
      subtypes: [],
      minRating: null,
      maxDistanceKm: null,
    });
  });

  it('never surfaces a distance chip for nearby, even with an (otherwise unreachable) non-null value', () => {
    const filters: Filters = { ...EMPTY_FILTERS, maxDistanceKm: 10 };
    const chips = filterChips(filters, 'nearby');
    expect(chips.find((c) => c.key === 'max-distance')).toBeUndefined();
  });

  it('a max-distance chip.remove() resets anywhere back to "no limit"', () => {
    const filters: Filters = { categories: [], subtypes: [], minRating: null, maxDistanceKm: 300 };
    const chips = filterChips(filters, 'anywhere');
    const distanceChip = chips.find((c) => c.key === 'max-distance')!;
    expect(distanceChip.remove().maxDistanceKm).toBeNull();
  });

  it('is empty for the empty (nearby) filter set', () => {
    expect(filterChips(EMPTY_FILTERS, 'nearby')).toEqual([]);
  });

  it('is empty for anywhere at "no limit"', () => {
    expect(filterChips(defaultFilters('anywhere'), 'anywhere')).toEqual([]);
  });
});

describe('buildActivitiesRequest', () => {
  it('never includes max_distance_km for nearby — the server always enforces its own fixed radius', () => {
    const req = buildActivitiesRequest(
      { scope: 'nearby', coordinates: { latitude: 1, longitude: 2 } },
      EMPTY_FILTERS
    );
    expect(req).toEqual({ scope: 'nearby', current_location: { lat: 1, lng: 2 } });
    expect(req.max_distance_km).toBeUndefined();
  });

  it('never includes max_distance_km for nearby even if somehow narrowed', () => {
    const req = buildActivitiesRequest(
      { scope: 'nearby', coordinates: { latitude: 1, longitude: 2 } },
      { categories: [], subtypes: [], minRating: null, maxDistanceKm: 25 }
    );
    expect(req.max_distance_km).toBeUndefined();
  });

  it('sends current_location for anywhere when a device-location anchor was resolved', () => {
    const req = buildActivitiesRequest(
      { scope: 'anywhere', coordinates: { latitude: 1, longitude: 2 } },
      defaultFilters('anywhere')
    );
    expect(req).toEqual({ scope: 'anywhere', current_location: { lat: 1, lng: 2 } });
  });

  it('omits current_location and max_distance_km for anywhere with no anchor', () => {
    const req = buildActivitiesRequest({ scope: 'anywhere' }, defaultFilters('anywhere'));
    expect(req).toEqual({ scope: 'anywhere' });
  });

  it('sends max_distance_km for anywhere only when narrowed below "no limit"', () => {
    const req = buildActivitiesRequest(
      { scope: 'anywhere', coordinates: { latitude: 1, longitude: 2 } },
      { categories: [], subtypes: [], minRating: null, maxDistanceKm: 300 }
    );
    expect(req.max_distance_km).toBe(300);
  });

  it('never sends max_distance_km for anywhere without an anchor, even if somehow narrowed', () => {
    const req = buildActivitiesRequest(
      { scope: 'anywhere' },
      { categories: [], subtypes: [], minRating: null, maxDistanceKm: 300 }
    );
    expect(req.max_distance_km).toBeUndefined();
  });

  it('includes only the set filter fields (nearby never gets max_distance_km)', () => {
    const filters: Filters = {
      categories: ['sport'],
      subtypes: [],
      minRating: 4.5,
      maxDistanceKm: null,
    };
    const req = buildActivitiesRequest({ scope: 'nearby', coordinates: { latitude: 1, longitude: 2 } }, filters);
    expect(req).toEqual({
      scope: 'nearby',
      current_location: { lat: 1, lng: 2 },
      categories: ['sport'],
      min_rating: 4.5,
    });
  });

  it('T3: wires selected subtypes into the request as subcategories, AND-ed with the single category', () => {
    const filters: Filters = {
      categories: ['sport'],
      subtypes: ['extreme_sports', 'climbing_gym'],
      minRating: null,
      maxDistanceKm: null,
    };
    const req = buildActivitiesRequest({ scope: 'nearby', coordinates: { latitude: 1, longitude: 2 } }, filters);
    expect(req.categories).toEqual(['sport']);
    expect(req.subcategories).toEqual(['extreme_sports', 'climbing_gym']);
  });

  it('T3: omits subcategories entirely when no subtype is selected', () => {
    const req = buildActivitiesRequest(
      { scope: 'nearby', coordinates: { latitude: 1, longitude: 2 } },
      { categories: ['sport'], subtypes: [], minRating: null, maxDistanceKm: null }
    );
    expect(req.subcategories).toBeUndefined();
  });
});

describe('anywhere distance-slider constants', () => {
  it('the "no limit" sentinel sits one step past the numeric ceiling', () => {
    expect(ANYWHERE_NO_LIMIT_SLIDER_VALUE).toBeGreaterThan(MAX_DISTANCE_KM_ANYWHERE);
  });
});
