import { anywhereHasAnchor, defaultScopeDraft } from './scopeDraft';

describe('defaultScopeDraft', () => {
  it('returns the widest/unset value for every field but keeps the given scope and coordinates', () => {
    const coordinates = { latitude: 1, longitude: 2 };
    expect(defaultScopeDraft('anywhere', coordinates)).toEqual({
      scope: 'anywhere',
      coordinates,
      cities: [],
      maxDistanceKm: null,
      minRating: null,
    });
  });

  it('leaves coordinates undefined when none are passed', () => {
    expect(defaultScopeDraft('nearby').coordinates).toBeUndefined();
  });
});

describe('anywhereHasAnchor', () => {
  it('is false with neither a city nor device coordinates', () => {
    expect(anywhereHasAnchor({ cities: [], coordinates: undefined })).toBe(false);
  });

  it('is true with a selected city', () => {
    expect(anywhereHasAnchor({ cities: [{ city: 'Lisbon', country: 'Portugal', centroid: { lat: 1, lng: 2 } }], coordinates: undefined })).toBe(true);
  });

  it('is true with device coordinates alone', () => {
    expect(anywhereHasAnchor({ cities: [], coordinates: { latitude: 1, longitude: 2 } })).toBe(true);
  });
});
