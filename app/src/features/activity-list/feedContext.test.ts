import { MapPin, Globe } from 'lucide-react-native';
import { contextLine, scopePillInfo } from './feedContext';

function city(city: string, country = 'X') {
  return { city, country, centroid: { lat: 0, lng: 0 } };
}

describe('scopePillInfo', () => {
  it('nearby -> "Nearby" + MapPin, no rating fields when minRating is null', () => {
    expect(scopePillInfo('nearby', [], null)).toEqual({
      label: 'Nearby',
      icon: MapPin,
      ratingLabel: null,
      ratingAccessibleLabel: null,
    });
  });

  it('anywhere with one city -> "Anywhere · City" + Globe, no +N', () => {
    expect(scopePillInfo('anywhere', [city('Barcelona')], null)).toEqual({
      label: 'Anywhere · Barcelona',
      icon: Globe,
      ratingLabel: null,
      ratingAccessibleLabel: null,
    });
  });

  it('anywhere with 2+ cities -> "Anywhere · City +N"', () => {
    expect(scopePillInfo('anywhere', [city('Barcelona'), city('Lisbon')], null)).toEqual({
      label: 'Anywhere · Barcelona +1',
      icon: Globe,
      ratingLabel: null,
      ratingAccessibleLabel: null,
    });
  });

  it('anywhere with no cities -> "Exploring everywhere" (cold start)', () => {
    expect(scopePillInfo('anywhere', [], null)).toEqual({
      label: 'Exploring everywhere',
      icon: Globe,
      ratingLabel: null,
      ratingAccessibleLabel: null,
    });
  });

  // T6, review round 1: an active minRating is carried as separate
  // ratingLabel/ratingAccessibleLabel fields, never folded into `label` —
  // FeedHeader renders ratingLabel as a non-truncating sibling Text so the
  // pill's ~176px text budget can't clip it off (see feedContext.ts's
  // ScopePillInfo comment). ratingAccessibleLabel reuses RatingRow's own
  // "Rated N and up" phrasing (ratingAccessibilityLabel in filters.ts), not
  // a bare "4.5+".
  it('an active minRating populates ratingLabel/ratingAccessibleLabel without touching label, for every scope shape', () => {
    expect(scopePillInfo('nearby', [], 4.5)).toEqual({
      label: 'Nearby',
      icon: MapPin,
      ratingLabel: '4.5+',
      ratingAccessibleLabel: 'Rated 4.5 and up',
    });
    expect(scopePillInfo('anywhere', [city('Barcelona')], 4.0)).toEqual({
      label: 'Anywhere · Barcelona',
      icon: Globe,
      ratingLabel: '4.0+',
      ratingAccessibleLabel: 'Rated 4.0 and up',
    });
    expect(scopePillInfo('anywhere', [], 4.8)).toEqual({
      label: 'Exploring everywhere',
      icon: Globe,
      ratingLabel: '4.8+',
      ratingAccessibleLabel: 'Rated 4.8 and up',
    });
  });

  it('clearing minRating (4.5 -> null) drops ratingLabel/ratingAccessibleLabel back to null; label was never touched by either', () => {
    const withRating = scopePillInfo('nearby', [], 4.5);
    const cleared = scopePillInfo('nearby', [], null);
    expect(withRating.label).toBe(cleared.label);
    expect(cleared).toEqual({ label: 'Nearby', icon: MapPin, ratingLabel: null, ratingAccessibleLabel: null });
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
