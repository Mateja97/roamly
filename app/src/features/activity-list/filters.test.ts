import { HOME_COUNTRY, HOME_LOCATION } from './config';
import { EMPTY_FILTERS, activeFilterCount, buildActivitiesRequest, filterChips } from './filters';
import type { Filters } from './types';

describe('activeFilterCount', () => {
  it('is 0 for the empty filter set', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it('counts each category plus each single-select group', () => {
    const filters: Filters = {
      categories: ['sports', 'food_and_drink'],
      priceTier: 'moderate',
      minRating: 4.5,
      maxDistanceKm: 25,
    };
    expect(activeFilterCount(filters)).toBe(5);
  });
});

describe('filterChips', () => {
  it('produces one chip per category and one per single-select group', () => {
    const filters: Filters = {
      categories: ['sports'],
      priceTier: 'moderate',
      minRating: 4.5,
      maxDistanceKm: 25,
    };
    const chips = filterChips(filters);
    expect(chips.map((c) => c.label)).toEqual(['Sports', '$$', '4.5+', '≤ 25 km']);
  });

  it('a chip.remove() clears only that one filter value', () => {
    const filters: Filters = { categories: ['sports', 'art_and_design'], priceTier: 'budget', minRating: null, maxDistanceKm: null };
    const chips = filterChips(filters);
    const sportsChip = chips.find((c) => c.label === 'Sports')!;
    expect(sportsChip.remove()).toEqual({
      categories: ['art_and_design'],
      priceTier: 'budget',
      minRating: null,
      maxDistanceKm: null,
    });
  });

  it('is empty for the empty filter set', () => {
    expect(filterChips(EMPTY_FILTERS)).toEqual([]);
  });
});

describe('buildActivitiesRequest', () => {
  it('sends current_location for nearby', () => {
    const req = buildActivitiesRequest(
      { scope: 'nearby', coordinates: { latitude: 1, longitude: 2 } },
      EMPTY_FILTERS
    );
    expect(req).toEqual({ scope: 'nearby', current_location: { lat: 1, lng: 2 } });
  });

  it('sends home_location for home', () => {
    const req = buildActivitiesRequest({ scope: 'home' }, EMPTY_FILTERS);
    expect(req).toEqual({ scope: 'home', home_location: HOME_LOCATION });
  });

  it('sends home_country for outside_country', () => {
    const req = buildActivitiesRequest({ scope: 'outside_country' }, EMPTY_FILTERS);
    expect(req).toEqual({ scope: 'outside_country', home_country: HOME_COUNTRY });
  });

  it('includes only the set filter fields', () => {
    const filters: Filters = {
      categories: ['sports'],
      priceTier: 'moderate',
      minRating: 4.5,
      maxDistanceKm: 25,
    };
    const req = buildActivitiesRequest({ scope: 'home' }, filters);
    expect(req).toEqual({
      scope: 'home',
      home_location: HOME_LOCATION,
      categories: ['sports'],
      price_tier: 'moderate',
      min_rating: 4.5,
      max_distance_km: 25,
    });
  });

  it('omits max_distance_km for outside_country even if set (T2 rejects it there)', () => {
    const filters: Filters = { ...EMPTY_FILTERS, maxDistanceKm: 25 };
    const req = buildActivitiesRequest({ scope: 'outside_country' }, filters);
    expect(req.max_distance_km).toBeUndefined();
  });
});
