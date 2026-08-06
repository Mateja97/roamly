import type { Activity } from '../../api/types';
import { hasPartnerId, resolveTourCity, toursDeepLink } from './toursPartner';

const activity = (city?: string): Activity => ({
  id: city ?? 'none',
  title: 'Old Town Walking Tour',
  description: '',
  category: 'tours_experiences',
  location: { lat: 0, lng: 0 },
  country: 'Serbia',
  rating: 4.7,
  image_refs: [],
  tags: [],
  distance_km: 1.2,
  city,
});

describe('resolveTourCity', () => {
  it('prefers the first selected city (Anywhere)', () => {
    const cities = [
      { city: 'Barcelona', country: 'Spain', centroid: { lat: 41.4, lng: 2.2 } },
      { city: 'Madrid', country: 'Spain', centroid: { lat: 40.4, lng: -3.7 } },
    ];
    expect(resolveTourCity(cities, [activity('Belgrade')])).toBe('Barcelona');
  });

  it("falls back to a loaded activity's city (Nearby)", () => {
    expect(resolveTourCity([], [activity(undefined), activity('Belgrade')])).toBe('Belgrade');
  });

  it('returns null when neither is available', () => {
    expect(resolveTourCity([], [])).toBeNull();
    expect(resolveTourCity([], [activity(undefined)])).toBeNull();
  });

  it('treats blank strings as absent rather than naming an empty city', () => {
    const cities = [{ city: '   ', country: 'Spain', centroid: { lat: 0, lng: 0 } }];
    expect(resolveTourCity(cities, [activity('Belgrade')])).toBe('Belgrade');
    expect(resolveTourCity([], [activity('  ')])).toBeNull();
  });
});

describe('toursDeepLink', () => {
  const original = process.env.EXPO_PUBLIC_GYG_PARTNER_ID;
  afterEach(() => {
    process.env.EXPO_PUBLIC_GYG_PARTNER_ID = original;
    if (original === undefined) delete process.env.EXPO_PUBLIC_GYG_PARTNER_ID;
  });

  it('searches the city and carries the partner id', () => {
    process.env.EXPO_PUBLIC_GYG_PARTNER_ID = 'ABC123';
    expect(toursDeepLink('Belgrade')).toBe('https://www.getyourguide.com/s/?q=Belgrade&partner_id=ABC123');
  });

  it('url-encodes city names with spaces and accents', () => {
    process.env.EXPO_PUBLIC_GYG_PARTNER_ID = 'ABC123';
    expect(toursDeepLink('Novi Sad')).toContain('q=Novi+Sad');
    expect(toursDeepLink('Málaga')).toContain('q=M%C3%A1laga');
  });

  it('drops the query and lands on the home page when no city is known', () => {
    process.env.EXPO_PUBLIC_GYG_PARTNER_ID = 'ABC123';
    expect(toursDeepLink(null)).toBe('https://www.getyourguide.com/?partner_id=ABC123');
  });

  it('reports a missing partner id so the caller can omit the ticket', () => {
    delete process.env.EXPO_PUBLIC_GYG_PARTNER_ID;
    expect(hasPartnerId()).toBe(false);
    process.env.EXPO_PUBLIC_GYG_PARTNER_ID = 'ABC123';
    expect(hasPartnerId()).toBe(true);
  });
});
