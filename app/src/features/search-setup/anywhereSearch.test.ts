import { buildAnywhereSearchRequest, defaultAnywhereSearchState, isAnywhereSearchDefault } from './anywhereSearch';

const suggestion = (city: string, country: string, lat: number, lng: number) => ({
  city,
  country,
  centroid: { lat, lng },
});

describe('buildAnywhereSearchRequest', () => {
  it('anchors on current_location when no cities are selected', () => {
    const request = buildAnywhereSearchRequest(
      { scope: 'anywhere', coordinates: { latitude: 1, longitude: 2 } },
      { maxDistanceKm: 500, cities: [], categories: [] }
    );
    expect(request).toEqual({ scope: 'anywhere', max_distance_km: 500, current_location: { lat: 1, lng: 2 } });
  });

  it('omits current_location entirely when no coordinates and no cities', () => {
    const request = buildAnywhereSearchRequest(
      { scope: 'anywhere' },
      { maxDistanceKm: 250, cities: [], categories: [] }
    );
    expect(request).toEqual({ scope: 'anywhere', max_distance_km: 250 });
  });

  it('anchors on the selected city centroids (union), ignoring current_location, when cities are picked', () => {
    const request = buildAnywhereSearchRequest(
      { scope: 'anywhere', coordinates: { latitude: 1, longitude: 2 } },
      { maxDistanceKm: 100, cities: [suggestion('Barcelona', 'Spain', 41.4, 2.2), suggestion('Rome', 'Italy', 41.9, 12.5)], categories: [] }
    );
    expect(request).toEqual({
      scope: 'anywhere',
      max_distance_km: 100,
      cities: [
        { lat: 41.4, lng: 2.2 },
        { lat: 41.9, lng: 12.5 },
      ],
    });
  });

  it('includes selected categories on top of the distance anchor', () => {
    const request = buildAnywhereSearchRequest(
      { scope: 'anywhere' },
      { maxDistanceKm: 500, cities: [], categories: ['sport', 'nature'] }
    );
    expect(request.categories).toEqual(['sport', 'nature']);
  });
});

describe('isAnywhereSearchDefault', () => {
  it('is true for the default state', () => {
    expect(isAnywhereSearchDefault(defaultAnywhereSearchState())).toBe(true);
  });

  it('is false once distance, a city, or a category diverges', () => {
    expect(isAnywhereSearchDefault({ maxDistanceKm: 100, cities: [], categories: [] })).toBe(false);
    expect(isAnywhereSearchDefault({ maxDistanceKm: 500, cities: [suggestion('Rome', 'Italy', 1, 2)], categories: [] })).toBe(false);
    expect(isAnywhereSearchDefault({ maxDistanceKm: 500, cities: [], categories: ['sport'] })).toBe(false);
  });
});
