import { EMPTY_FILTERS, activeFilterCount, buildActivitiesRequest, filterChips } from './filters';
import type { Filters } from './types';

const HOME_LOCATION = { lat: 44.8125, lng: 20.4612 };
const HOME_COUNTRY = 'Serbia';

describe('activeFilterCount', () => {
  it('is 0 for the empty filter set', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it('counts each category plus each single-select group', () => {
    const filters: Filters = {
      categories: ['sports', 'food_and_drink'],
      minRating: 4.5,
      maxDistanceKm: 25,
    };
    expect(activeFilterCount(filters)).toBe(4);
  });
});

describe('filterChips', () => {
  it('produces one chip per category and one per single-select group', () => {
    const filters: Filters = {
      categories: ['sports'],
      minRating: 4.5,
      maxDistanceKm: 25,
    };
    const chips = filterChips(filters);
    expect(chips.map((c) => c.label)).toEqual(['Sports', '4.5+', '≤ 25 km']);
  });

  it('a chip.remove() clears only that one filter value', () => {
    const filters: Filters = { categories: ['sports', 'art_and_design'], minRating: null, maxDistanceKm: 25 };
    const chips = filterChips(filters);
    const sportsChip = chips.find((c) => c.label === 'Sports')!;
    expect(sportsChip.remove()).toEqual({
      categories: ['art_and_design'],
      minRating: null,
      maxDistanceKm: 25,
    });
  });

  it('a max-distance chip.remove() resets the radius to the 50km ceiling', () => {
    const filters: Filters = { ...EMPTY_FILTERS, maxDistanceKm: 10 };
    const chips = filterChips(filters);
    const distanceChip = chips.find((c) => c.key === 'max-distance')!;
    expect(distanceChip.remove().maxDistanceKm).toBe(50);
  });

  it('is empty for the empty filter set', () => {
    expect(filterChips(EMPTY_FILTERS)).toEqual([]);
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

  it('sends home_location for home, plus the slider default (50km ceiling)', () => {
    const req = buildActivitiesRequest({ scope: 'home', homeLocation: HOME_LOCATION }, EMPTY_FILTERS);
    expect(req).toEqual({ scope: 'home', home_location: HOME_LOCATION, max_distance_km: 50 });
  });

  it('sends home_country and the top_rated sort flag for outside_country', () => {
    const req = buildActivitiesRequest({ scope: 'outside_country', homeCountry: HOME_COUNTRY }, EMPTY_FILTERS);
    expect(req).toEqual({ scope: 'outside_country', home_country: HOME_COUNTRY, sort: 'top_rated' });
  });

  it('does not send the sort flag for home or nearby', () => {
    expect(buildActivitiesRequest({ scope: 'home', homeLocation: HOME_LOCATION }, EMPTY_FILTERS).sort).toBeUndefined();
    expect(
      buildActivitiesRequest({ scope: 'nearby', coordinates: { latitude: 1, longitude: 2 } }, EMPTY_FILTERS).sort
    ).toBeUndefined();
  });

  it('omits home_location/home_country when not yet resolved', () => {
    expect(buildActivitiesRequest({ scope: 'home' }, EMPTY_FILTERS)).toEqual({ scope: 'home', max_distance_km: 50 });
    expect(buildActivitiesRequest({ scope: 'outside_country' }, EMPTY_FILTERS)).toEqual({ scope: 'outside_country' });
  });

  it('includes only the set filter fields', () => {
    const filters: Filters = {
      categories: ['sports'],
      minRating: 4.5,
      maxDistanceKm: 25,
    };
    const req = buildActivitiesRequest({ scope: 'home', homeLocation: HOME_LOCATION }, filters);
    expect(req).toEqual({
      scope: 'home',
      home_location: HOME_LOCATION,
      categories: ['sports'],
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
