import type { Activity } from '../../api/types';
import { hasPartnerId, resolveTourLocation, tourTarget, toursDeepLink } from './toursPartner';

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

describe('resolveTourLocation', () => {
  it('prefers the first selected city (Anywhere)', () => {
    const cities = [
      { city: 'Barcelona', country: 'Spain', centroid: { lat: 41.4, lng: 2.2 } },
      { city: 'Madrid', country: 'Spain', centroid: { lat: 40.4, lng: -3.7 } },
    ];
    expect(resolveTourLocation(cities, [activity('Belgrade')])).toEqual({ city: 'Barcelona', country: 'Spain' });
  });

  it("falls back to a loaded activity's city and country (Nearby)", () => {
    expect(resolveTourLocation([], [activity(undefined), activity('Belgrade')])).toEqual({
      city: 'Belgrade',
      country: 'Serbia',
    });
  });

  it('returns null when neither is available', () => {
    expect(resolveTourLocation([], [])).toBeNull();
    expect(resolveTourLocation([], [activity(undefined)])).toBeNull();
  });

  it('treats blank strings as absent rather than naming an empty city', () => {
    const cities = [{ city: '   ', country: 'Spain', centroid: { lat: 0, lng: 0 } }];
    expect(resolveTourLocation(cities, [activity('Belgrade')])).toEqual({ city: 'Belgrade', country: 'Serbia' });
    expect(resolveTourLocation([], [activity('  ')])).toBeNull();
  });
});

describe('tourTarget', () => {
  it('names and searches a city with confirmed inventory', () => {
    expect(tourTarget({ city: 'Belgrade', country: 'Serbia' })).toEqual({ city: 'Belgrade', query: 'Belgrade' });
    // Case and padding are comparison-only; the label keeps what arrived.
    expect(tourTarget({ city: ' belgrade ', country: 'Serbia' })).toEqual({ city: ' belgrade ', query: ' belgrade ' });
  });

  // Novi Pazar returns a single Belgrade day-trip. Naming it would be a
  // promise GetYourGuide can't keep, so the card goes generic and the search
  // widens to where the inventory actually is.
  it('drops the city name and widens to the country when inventory is unconfirmed', () => {
    expect(tourTarget({ city: 'Novi Pazar', country: 'Serbia' })).toEqual({ city: null, query: 'Serbia' });
  });

  it('promises nothing with no location at all', () => {
    expect(tourTarget(null)).toEqual({ city: null, query: null });
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

  // An untracked referral earns nothing, so the builder refuses to produce
  // one even if a future caller forgets the hasPartnerId() guard.
  it('returns null rather than an unattributed link when the partner id is unset', () => {
    delete process.env.EXPO_PUBLIC_GYG_PARTNER_ID;
    expect(toursDeepLink('Belgrade')).toBeNull();
    expect(toursDeepLink(null)).toBeNull();
  });
});
