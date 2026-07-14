import {
  ANYWHERE_NO_LIMIT_SLIDER_VALUE,
  EMPTY_FILTERS,
  MAX_DISTANCE_KM_ANYWHERE,
  activeFilterCount,
  buildActivitiesRequest,
  defaultFilters,
  filterChips,
} from './filters';
import type { Filters } from './types';

describe('defaultFilters', () => {
  it("nearby's default is the 50km ceiling", () => {
    expect(defaultFilters('nearby')).toEqual({ categories: [], minRating: null, maxDistanceKm: 50 });
  });

  it('anywhere\'s default is "no limit" (null)', () => {
    expect(defaultFilters('anywhere')).toEqual({ categories: [], minRating: null, maxDistanceKm: null });
  });
});

describe('activeFilterCount', () => {
  it('is 0 for the empty (nearby) filter set', () => {
    expect(activeFilterCount(EMPTY_FILTERS, 'nearby')).toBe(0);
  });

  it('is 0 for anywhere at its "no limit" default', () => {
    expect(activeFilterCount(defaultFilters('anywhere'), 'anywhere')).toBe(0);
  });

  it('counts each category plus each single-select group (nearby)', () => {
    const filters: Filters = {
      categories: ['sports', 'food_and_drink'],
      minRating: 4.5,
      maxDistanceKm: 25,
    };
    expect(activeFilterCount(filters, 'nearby')).toBe(4);
  });

  it('counts a narrowed anywhere distance as an active filter', () => {
    const filters: Filters = { categories: [], minRating: null, maxDistanceKm: 300 };
    expect(activeFilterCount(filters, 'anywhere')).toBe(1);
  });
});

describe('filterChips', () => {
  it('produces one chip per category and one per single-select group', () => {
    const filters: Filters = {
      categories: ['sports'],
      minRating: 4.5,
      maxDistanceKm: 25,
    };
    const chips = filterChips(filters, 'nearby');
    expect(chips.map((c) => c.label)).toEqual(['Sports', '4.5+', '≤ 25 km']);
  });

  it('a chip.remove() clears only that one filter value', () => {
    const filters: Filters = { categories: ['sports', 'art_and_design'], minRating: null, maxDistanceKm: 25 };
    const chips = filterChips(filters, 'nearby');
    const sportsChip = chips.find((c) => c.label === 'Sports')!;
    expect(sportsChip.remove()).toEqual({
      categories: ['art_and_design'],
      minRating: null,
      maxDistanceKm: 25,
    });
  });

  it('a max-distance chip.remove() resets nearby to the 50km ceiling', () => {
    const filters: Filters = { ...EMPTY_FILTERS, maxDistanceKm: 10 };
    const chips = filterChips(filters, 'nearby');
    const distanceChip = chips.find((c) => c.key === 'max-distance')!;
    expect(distanceChip.remove().maxDistanceKm).toBe(50);
  });

  it('a max-distance chip.remove() resets anywhere back to "no limit"', () => {
    const filters: Filters = { categories: [], minRating: null, maxDistanceKm: 300 };
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
  it('sends current_location for nearby, plus the slider default (50km ceiling)', () => {
    const req = buildActivitiesRequest(
      { scope: 'nearby', coordinates: { latitude: 1, longitude: 2 } },
      EMPTY_FILTERS
    );
    expect(req).toEqual({ scope: 'nearby', current_location: { lat: 1, lng: 2 }, max_distance_km: 50 });
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
      { categories: [], minRating: null, maxDistanceKm: 300 }
    );
    expect(req.max_distance_km).toBe(300);
  });

  it('never sends max_distance_km for anywhere without an anchor, even if somehow narrowed', () => {
    const req = buildActivitiesRequest(
      { scope: 'anywhere' },
      { categories: [], minRating: null, maxDistanceKm: 300 }
    );
    expect(req.max_distance_km).toBeUndefined();
  });

  it('includes only the set filter fields', () => {
    const filters: Filters = {
      categories: ['sports'],
      minRating: 4.5,
      maxDistanceKm: 25,
    };
    const req = buildActivitiesRequest({ scope: 'nearby', coordinates: { latitude: 1, longitude: 2 } }, filters);
    expect(req).toEqual({
      scope: 'nearby',
      current_location: { lat: 1, lng: 2 },
      categories: ['sports'],
      min_rating: 4.5,
      max_distance_km: 25,
    });
  });
});

describe('anywhere distance-slider constants', () => {
  it('the "no limit" sentinel sits one step past the numeric ceiling', () => {
    expect(ANYWHERE_NO_LIMIT_SLIDER_VALUE).toBeGreaterThan(MAX_DISTANCE_KM_ANYWHERE);
  });
});
