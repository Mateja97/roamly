import { CATEGORY_OPTIONS } from './filters';
import { orderCategories, timeBucket } from './categoryOrder';

const ALL_CATEGORIES = CATEGORY_OPTIONS.map((o) => o.value);

describe('timeBucket', () => {
  it('7am is morning', () => expect(timeBucket(7)).toBe('morning'));
  it('9pm is evening', () => expect(timeBucket(21)).toBe('evening'));
  it('11pm is late-night', () => expect(timeBucket(23)).toBe('late-night'));
  it('2am is late-night', () => expect(timeBucket(2)).toBe('late-night'));
  it('1pm is the day residual bucket', () => expect(timeBucket(13)).toBe('day'));
});

describe('orderCategories', () => {
  it('morning floats Cafés to the front, rest stays in taxonomy order', () => {
    const order = orderCategories(7, false);
    expect(order[0]).toBe('cafes');
    expect(order).toEqual(['cafes', ...ALL_CATEGORIES.filter((c) => c !== 'cafes')]);
  });

  it('evening floats Restaurants + Bars to the front, in that order', () => {
    const order = orderCategories(19, false);
    expect(order.slice(0, 2)).toEqual(['restaurants', 'bars']);
  });

  it('after 22:00 floats Nightlife to the front', () => {
    const order = orderCategories(23, false);
    expect(order[0]).toBe('nightlife');
  });

  it('the day bucket floats nothing — stable taxonomy order throughout', () => {
    expect(orderCategories(13, false)).toEqual(ALL_CATEGORIES);
  });

  it('traveler mode floats Tours & Experiences + Culture ahead of any time float', () => {
    const order = orderCategories(19, true);
    expect(order.slice(0, 4)).toEqual(['tours_experiences', 'culture', 'restaurants', 'bars']);
  });

  it('every category still appears exactly once regardless of bucket/traveler combo', () => {
    for (const hour of [3, 7, 13, 19, 23]) {
      for (const traveler of [false, true]) {
        const order = orderCategories(hour, traveler);
        expect(order).toHaveLength(ALL_CATEGORIES.length);
        expect(new Set(order).size).toBe(ALL_CATEGORIES.length);
      }
    }
  });

  it('is a pure function of (hour, travelerMode) — no selection input, so a caller can never reorder by selecting', () => {
    // orderCategories.length is the function's declared arity — asserting
    // it directly is the simplest possible guard against a future edit
    // smuggling a `selectedCategories` param back in (design-spec.md T3's
    // "selecting a category must not reorder the row" rule).
    expect(orderCategories.length).toBe(2);
  });
});
