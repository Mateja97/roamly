import { hasMapsKey, hasValidCoordinates, staticMapUrl } from './staticMap';

describe('staticMap', () => {
  const original = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  afterEach(() => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = original;
  });

  it('hasMapsKey is false when the env var is unset', () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
    expect(hasMapsKey()).toBe(false);
  });

  it('hasMapsKey is true when the env var is set', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    expect(hasMapsKey()).toBe(true);
  });

  it('hasValidCoordinates rejects missing and (0,0) locations', () => {
    expect(hasValidCoordinates(undefined)).toBe(false);
    expect(hasValidCoordinates({ lat: 0, lng: 0 })).toBe(false);
    expect(hasValidCoordinates({ lat: 44.8, lng: 20.5 })).toBe(true);
  });

  it('builds a static map URL with the gold marker and given size', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    const url = staticMapUrl({ lat: 44.8153, lng: 20.4646 }, 72);
    expect(url).toContain('https://maps.googleapis.com/maps/api/staticmap?');
    expect(url).toContain('size=72x72');
    expect(url).toContain('color%3A0xCE9042');
    expect(url).toContain('key=test-key');
  });
});
