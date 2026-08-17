import { MapPin, Globe } from 'lucide-react-native';
import { contextLine, scopePillInfo } from './feedContext';

function city(city: string, country = 'X') {
  return { city, country, centroid: { lat: 0, lng: 0 } };
}

describe('scopePillInfo', () => {
  it('nearby -> "Nearby" + MapPin', () => {
    expect(scopePillInfo('nearby', [], null)).toEqual({ label: 'Nearby', icon: MapPin });
  });

  it('anywhere with one city -> "Anywhere · City" + Globe, no +N', () => {
    expect(scopePillInfo('anywhere', [city('Barcelona')], null)).toEqual({ label: 'Anywhere · Barcelona', icon: Globe });
  });

  it('anywhere with 2+ cities -> "Anywhere · City +N"', () => {
    expect(scopePillInfo('anywhere', [city('Barcelona'), city('Lisbon')], null)).toEqual({
      label: 'Anywhere · Barcelona +1',
      icon: Globe,
    });
  });

  it('anywhere with no cities -> "Exploring everywhere" (cold start)', () => {
    expect(scopePillInfo('anywhere', [], null)).toEqual({ label: 'Exploring everywhere', icon: Globe });
  });

  // T6: an active minRating appends " · {rating}+" to every scope shape's
  // label; clearing it (back to null) returns the exact unfiltered label.
  it('an active minRating appends " · {rating}+" regardless of scope shape', () => {
    expect(scopePillInfo('nearby', [], 4.5)).toEqual({ label: 'Nearby · 4.5+', icon: MapPin });
    expect(scopePillInfo('anywhere', [city('Barcelona')], 4.0)).toEqual({
      label: 'Anywhere · Barcelona · 4.0+',
      icon: Globe,
    });
    expect(scopePillInfo('anywhere', [], 4.8)).toEqual({ label: 'Exploring everywhere · 4.8+', icon: Globe });
  });

  it('clearing minRating (null) returns the pill to its unfiltered label', () => {
    expect(scopePillInfo('nearby', [], null)).toEqual({ label: 'Nearby', icon: MapPin });
  });
});

describe('contextLine', () => {
  it('nearby morning', () => expect(contextLine('nearby', [], 7, false)).toBe('This morning near you'));
  it('nearby evening', () => expect(contextLine('nearby', [], 19, false)).toBe('Tonight near you'));
  it('nearby late-night', () => expect(contextLine('nearby', [], 23, false)).toBe('Tonight near you'));
  it('nearby midday has a defined non-empty fallback', () => {
    expect(contextLine('nearby', [], 13, false)).toBe('Right now, near you');
  });

  it('nearby + traveler mode surfaces the traveler signal instead of the plain time-of-day copy (no city name available for Nearby)', () => {
    expect(contextLine('nearby', [], 7, true)).toBe('New in town? Worth seeing nearby');
    expect(contextLine('nearby', [], 19, true)).toBe('New in town? Worth seeing nearby');
  });

  it('anywhere with cities, no traveler signal -> "Exploring {cities}"', () => {
    expect(contextLine('anywhere', [city('Barcelona'), city('Lisbon')], 13, false)).toBe('Exploring Barcelona & Lisbon');
  });

  it('anywhere with cities + traveler mode -> "New in town?" copy', () => {
    expect(contextLine('anywhere', [city('Lisbon')], 13, true)).toBe('New in town? The best of Lisbon');
  });

  it('anywhere cold start (no cities) has a defined non-empty fallback', () => {
    expect(contextLine('anywhere', [], 13, false)).toBe('Explore places worth the trip');
  });
});
