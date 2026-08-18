import { Clock } from 'lucide-react-native';
import type { Activity } from '../../api/activities';
import { CATEGORY_LABELS, CATEGORY_OPTIONS } from './filters';
import type { Category } from './types';
import {
  bodySectionOrder,
  factStripFields,
  getWebsiteURL,
  goodToKnowSection,
  googleReviewsScoreShown,
  googleReviewsSectionShown,
  isTripadvisorSourced,
  kidsAgeLabel,
  metaDistanceText,
  metaLineLeadItems,
  subtypeLabel,
  toursIncludedChecklist,
  toursItinerary,
  toursMeetingPoint,
  tripadvisorAddressLine,
  tripadvisorAttribution,
  tripadvisorEyebrow,
  tripadvisorReviews,
  uniqueSection,
  venueDiffersFromSubtype,
} from './activityDetailConfig';
import { classifyFactChips } from './FactStrip';

// 2024-01-01 is a Monday. Fixing the clock lets every case below assert an
// exact venue-local weekday/time without depending on the host machine's
// own timezone (Intl reads the `timezone` string, never the device's).
const MONDAY_NOON_UTC = new Date('2024-01-01T12:00:00Z');

function baseActivity(details: Activity['details']): Activity {
  return {
    id: '1',
    title: 'Test venue',
    description: '',
    category: details?.category ?? 'cafes',
    location: { lat: 0, lng: 0 },
    country: 'Testland',
    rating: 4.5,
    image_refs: [],
    tags: [],
    distance_km: 1,
    details,
  };
}

// website-url-action-chip T2: `getWebsiteURL` replaces the old 8-case
// `primaryActionURL` switch — every one of the 13 `ActivityDetails` branches
// now carries `website_url`, so this is a plain common-property read.
describe('getWebsiteURL (website-url-action-chip T2)', () => {
  const detailsWithWebsiteByCategory: Record<Category, Activity['details']> = {
    restaurants: { category: 'restaurants', website_url: 'https://example.com/restaurants' },
    bars: { category: 'bars', website_url: 'https://example.com/bars' },
    cafes: { category: 'cafes', website_url: 'https://example.com/cafes' },
    nightlife: { category: 'nightlife', website_url: 'https://example.com/nightlife' },
    nature: { category: 'nature', website_url: 'https://example.com/nature' },
    sport: { category: 'sport', website_url: 'https://example.com/sport' },
    kids: { category: 'kids', website_url: 'https://example.com/kids' },
    culture: { category: 'culture', website_url: 'https://example.com/culture' },
    art: { category: 'art', website_url: 'https://example.com/art' },
    wellness: { category: 'wellness', website_url: 'https://example.com/wellness' },
    entertainment: { category: 'entertainment', website_url: 'https://example.com/entertainment' },
    shopping: { category: 'shopping', website_url: 'https://example.com/shopping' },
    tours_experiences: {
      category: 'tours_experiences',
      website_url: 'https://example.com/tours_experiences',
    },
  };

  it.each(CATEGORY_OPTIONS.map((option) => option.value))(
    'returns the website_url for %s',
    (category) => {
      const activity = baseActivity(detailsWithWebsiteByCategory[category]);
      expect(getWebsiteURL(activity)).toBe(`https://example.com/${category}`);
    },
  );

  it('returns undefined when the category has no website_url', () => {
    expect(getWebsiteURL(baseActivity({ category: 'restaurants' }))).toBeUndefined();
  });

  it('returns undefined when details is absent entirely', () => {
    expect(getWebsiteURL(baseActivity(undefined))).toBeUndefined();
  });
});

describe('factStripFields — Hours chip (opening-hours T3)', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(MONDAY_NOON_UTC);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  // T4 (activity-detail-system): structured opening_hours now renders as
  // its own standalone HoursRow (design-spec.md's "Hours row" slot leaves
  // the stat grid entirely) — see HoursRow.test.tsx for that behavior.
  // `factStripFields` itself only ever appends the legacy free-text
  // fallback, and only when there's no usable structured data.
  it('omits any Hours chip from the fact strip when structured data is usable (moved to the standalone HoursRow)', () => {
    const activity = baseActivity({
      category: 'restaurants',
      hours: '9am–11pm',
      opening_hours: {
        timezone: 'UTC',
        periods: [{ day: 'monday', open: '09:00', close: '17:00' }],
      },
    });
    expect(factStripFields(activity).some((f) => f.label === '09:00–17:00')).toBe(false);
    expect(factStripFields(activity).some((f) => f.label === 'Hours')).toBe(false);
  });

  it('keeps the plain legacy chip when there is no usable structured data', () => {
    const activity = baseActivity({
      category: 'restaurants',
      hours: '9am–11pm',
    });
    const hours = factStripFields(activity).find((f) => f.label === 'Hours');
    expect(hours).toEqual({
      icon: Clock,
      label: 'Hours',
      value: '9am–11pm',
    });
  });

  it('omits the Hours chip entirely when there is neither structured nor legacy data', () => {
    const activity = baseActivity({ category: 'restaurants' });
    expect(factStripFields(activity).some((f) => f.label === 'Hours')).toBe(
      false,
    );
  });

  it('never appends a fact-strip Hours chip for always_open or fully-closed-today venues (HoursRow owns those now)', () => {
    const alwaysOpen = baseActivity({
      category: 'shopping',
      opening_hours: { timezone: 'UTC', always_open: true },
    });
    expect(factStripFields(alwaysOpen).some((f) => f.label === 'Open 24 hours')).toBe(false);

    const closedToday = baseActivity({
      category: 'cafes',
      opening_hours: {
        timezone: 'UTC',
        periods: [{ day: 'tuesday', open: '09:00', close: '17:00' }],
      },
    });
    expect(factStripFields(closedToday).some((f) => f.label === 'Closed today')).toBe(false);
  });
});

describe('tripadvisorAttribution / tripadvisorReviews (T8/T4)', () => {
  it('reads `tripadvisor`/`reviews` off a restaurant row', () => {
    const activity = baseActivity({
      category: 'restaurants',
      tripadvisor: {
        rating_image_url: 'https://tripadvisor.example/bubble.png',
        review_count: 1204,
        web_url: 'https://tripadvisor.example/place',
      },
      reviews: [{ rating: 5, date: '14 June 2026', text: 'Fantastic evening.' }],
    });
    expect(tripadvisorAttribution(activity)).toMatchObject({ review_count: 1204 });
    expect(tripadvisorReviews(activity)).toMatchObject([{ rating: 5 }]);
  });

  it('reads `tripadvisor` off a bar row too, with a review', () => {
    const activity = baseActivity({
      category: 'bars',
      tripadvisor: {
        rating_image_url: 'https://tripadvisor.example/bubble.png',
        review_count: 88,
        web_url: 'https://tripadvisor.example/place',
      },
      reviews: [{ rating: 5, date: '1 June 2026', text: 'Great spot.' }],
    });
    expect(tripadvisorAttribution(activity)).toMatchObject({ review_count: 88 });
  });

  it('is undefined for a non-Tripadvisor restaurant row (field simply absent), reviews defaults to []', () => {
    const activity = baseActivity({ category: 'restaurants', cuisine: 'Serbian' });
    expect(tripadvisorAttribution(activity)).toBeUndefined();
    expect(tripadvisorReviews(activity)).toEqual([]);
  });

  it('reads `tripadvisor`/`reviews` off a café row too — cafés is the one dual-sourced category (#104)', () => {
    const activity = baseActivity({
      category: 'cafes',
      known_for_brew: 'Pour-over',
      tripadvisor: {
        rating_image_url: 'https://tripadvisor.example/bubble.png',
        review_count: 104,
        web_url: 'https://tripadvisor.example/place',
      },
      reviews: [{ rating: 4, date: '3 May 2026', text: 'Great espresso.' }],
    });
    expect(tripadvisorAttribution(activity)).toMatchObject({ review_count: 104 });
    expect(tripadvisorReviews(activity)).toMatchObject([{ rating: 4 }]);
  });

  it('is undefined for a non-Tripadvisor café row (Google-sourced, field simply absent)', () => {
    const activity = baseActivity({ category: 'cafes', known_for_brew: 'Pour-over' });
    expect(tripadvisorAttribution(activity)).toBeUndefined();
    expect(tripadvisorReviews(activity)).toEqual([]);
  });

  it('is undefined for a category that never carries the field (e.g. nightlife)', () => {
    const activity = baseActivity({ category: 'nightlife', venue_type: 'Club' });
    expect(tripadvisorAttribution(activity)).toBeUndefined();
    expect(tripadvisorReviews(activity)).toEqual([]);
  });

  it('defaults to [] with no details at all', () => {
    const activity = baseActivity(undefined);
    expect(tripadvisorAttribution(activity)).toBeUndefined();
    expect(tripadvisorReviews(activity)).toEqual([]);
  });
});

// tripadvisor-marks-require-reviews (T2): the gate itself — three states —
// plus the ungated raw-presence helper the rating-suppression rule reads.
describe('tripadvisorAttribution() gate + isTripadvisorSourced() (T2)', () => {
  const tripadvisor = {
    rating_image_url: 'https://tripadvisor.example/bubble.png',
    review_count: 1204,
    web_url: 'https://tripadvisor.example/place',
  };

  it('returns the attribution when reviews.length >= 1', () => {
    const activity = baseActivity({
      category: 'restaurants',
      tripadvisor,
      reviews: [{ rating: 5, date: '1 June 2026', text: 'Great spot.' }],
    });
    expect(tripadvisorAttribution(activity)).toMatchObject({ review_count: 1204 });
  });

  it('is undefined when reviews is an explicit empty array', () => {
    const activity = baseActivity({ category: 'restaurants', tripadvisor, reviews: [] });
    expect(tripadvisorAttribution(activity)).toBeUndefined();
  });

  it('is undefined when the reviews key is absent entirely', () => {
    const activity = baseActivity({ category: 'restaurants', tripadvisor });
    expect(tripadvisorAttribution(activity)).toBeUndefined();
  });

  it('isTripadvisorSourced is true regardless of reviews (present, empty, or absent) — the raw presence check', () => {
    expect(isTripadvisorSourced(baseActivity({ category: 'restaurants', tripadvisor }))).toBe(true);
    expect(isTripadvisorSourced(baseActivity({ category: 'restaurants', tripadvisor, reviews: [] }))).toBe(true);
    expect(
      isTripadvisorSourced(
        baseActivity({
          category: 'restaurants',
          tripadvisor,
          reviews: [{ rating: 5, date: '1 June 2026', text: 'Great spot.' }],
        }),
      ),
    ).toBe(true);
  });

  it('isTripadvisorSourced is false for a non-Tripadvisor row and for a category that never carries the field', () => {
    expect(isTripadvisorSourced(baseActivity({ category: 'restaurants', cuisine: 'Serbian' }))).toBe(false);
    expect(isTripadvisorSourced(baseActivity({ category: 'nightlife', venue_type: 'Club' }))).toBe(false);
    expect(isTripadvisorSourced(baseActivity(undefined))).toBe(false);
  });
});

describe('factStripFields — Tripadvisor rows drop Cuisine (§5b eyebrow carries it instead)', () => {
  it('omits the Cuisine chip for a row that keeps the Tripadvisor treatment, even when the legacy field is populated', () => {
    const activity = baseActivity({
      category: 'restaurants',
      cuisine: 'Italian',
      tripadvisor: {
        rating_image_url: 'https://tripadvisor.example/bubble.png',
        review_count: 1204,
        web_url: 'https://tripadvisor.example/place',
      },
      reviews: [{ rating: 5, date: '1 June 2026', text: 'Great spot.' }],
    });
    const labels = factStripFields(activity).map((f) => f.label);
    expect(labels).not.toContain('Cuisine');
  });

  it('keeps the Cuisine chip for a non-Tripadvisor restaurant row, unchanged', () => {
    const activity = baseActivity({ category: 'restaurants', cuisine: 'Italian' });
    const labels = factStripFields(activity).map((f) => f.label);
    expect(labels).toContain('Cuisine');
  });

  // tripadvisor-marks-require-reviews (T2): routed through the gated
  // `tripadvisorAttribution()` helper now, not the raw `d.tripadvisor`
  // field — a de-marked (review-less) row is an ordinary row again, so the
  // generic Cuisine chip is restored for it too.
  it('restores the Cuisine chip for a de-marked (review-less) Tripadvisor row', () => {
    const activity = baseActivity({
      category: 'restaurants',
      cuisine: 'Italian',
      tripadvisor: {
        rating_image_url: 'https://tripadvisor.example/bubble.png',
        review_count: 1204,
        web_url: 'https://tripadvisor.example/place',
      },
      // No `reviews` key.
    });
    const labels = factStripFields(activity).map((f) => f.label);
    expect(labels).toContain('Cuisine');
  });

  // T2: `price_tier` is no longer read into a chip at all, for any
  // restaurant row (Tripadvisor or not) — the field itself stays on the
  // backend model (T1 scope), only its rendering slot is gone.
  it('T2: never renders a Price chip for restaurants, even when price_tier is present', () => {
    const activity = baseActivity({ category: 'restaurants', cuisine: 'Italian', price_tier: '€€' });
    const labels = factStripFields(activity).map((f) => f.label);
    expect(labels).not.toContain('Price');
  });
});

// T6 (design-spec.md §C, Bars entry): "Contract change: `vibe` must be
// `scalar` (`Intimate`) or absent" — the spec's own explicitly flagged
// at-risk field. `factStripFields` itself only builds the raw chip (the
// classification happens at render time, same as every other stat-grid
// field, per FactStrip's own `classifyFactChips`) — this test proves the
// two compose correctly for Bars specifically, not just generically.
describe('factStripFields — Bars vibe (T6, spec-flagged at-risk field)', () => {
  it('omits a sentence-shaped vibe value once classified, keeping the other valid chips', () => {
    const activity = baseActivity({
      category: 'bars',
      vibe: 'The atmosphere here is genuinely impossible to describe in one word.',
      happy_hour_window: '17:00–19:00',
      opens_time: '17:00',
    });
    const labels = classifyFactChips(factStripFields(activity)).map((f) => f.label);
    expect(labels).not.toContain('Vibe');
    expect(labels).toContain('Happy hour');
    expect(labels).toContain('Opens');
  });

  it('keeps a legitimate scalar vibe value (the spec\'s own example)', () => {
    const activity = baseActivity({
      category: 'bars',
      vibe: 'Intimate',
      happy_hour_window: '17:00–19:00',
      opens_time: '17:00',
    });
    const chips = classifyFactChips(factStripFields(activity));
    expect(chips.find((f) => f.label === 'Vibe')?.value).toBe('Intimate');
  });
});

// T6/T2 (design-spec.md §C): Restaurants/Bars/Cafés' unique-section shape +
// heading mapping — the shape-level rendering itself is already covered
// generically in UniqueSection.test.tsx; this pins each of the three
// categories to its specified density. T2: Popular dishes/On the bar moved
// from the retired 'nameprice' shape to 'pills', name only — `.price` is
// dropped at this mapping layer, not merely unrendered.
describe('uniqueSection — Restaurants/Bars/Cafés (T6/T2)', () => {
  it('Restaurants: "Popular dishes" using pills, name only (price dropped)', () => {
    const activity = baseActivity({
      category: 'restaurants',
      popular_dishes: [{ name: 'Truffle pasta', price: '€14' }],
    });
    expect(uniqueSection(activity)).toEqual({
      shape: 'pills',
      heading: 'Popular dishes',
      items: ['Truffle pasta'],
    });
  });

  it('Restaurants: "Popular dishes" section omits when the list is empty', () => {
    const activity = baseActivity({ category: 'restaurants', popular_dishes: [] });
    expect(uniqueSection(activity)).toBeUndefined();
  });

  // Round-2 fix: a blank/denylisted name used to render as an empty pill
  // (the retired 'nameprice' shape's `isEmptyNamePriceList` + per-row
  // `.trim()` filter died with it) — now runs through the same
  // `classifyPhrases` survival rule as Wellness' Treatments/Tours'
  // checklists, so a blank name drops individually and its siblings render.
  it('Restaurants: drops a popular dish whose name is blank, keeping its siblings', () => {
    const activity = baseActivity({
      category: 'restaurants',
      popular_dishes: [
        { name: 'Truffle pasta', price: '€14' },
        { name: '', price: '€8' },
      ],
    });
    expect(uniqueSection(activity)).toEqual({
      shape: 'pills',
      heading: 'Popular dishes',
      items: ['Truffle pasta'],
    });
  });

  it('Restaurants: "Popular dishes" section omits (0 survivors) when every name is blank', () => {
    const activity = baseActivity({
      category: 'restaurants',
      popular_dishes: [
        { name: '', price: '€8' },
        { name: '   ', price: '€9' },
      ],
    });
    expect(uniqueSection(activity)).toBeUndefined();
  });

  it('Bars: "Signature pours" using the pills density', () => {
    const activity = baseActivity({
      category: 'bars',
      signature_pours: ['Rakija sour', 'Amaro spritz'],
    });
    expect(uniqueSection(activity)).toEqual({
      shape: 'pills',
      heading: 'Signature pours',
      items: ['Rakija sour', 'Amaro spritz'],
    });
  });

  it('Cafés: "On the bar" using pills, name only (price dropped)', () => {
    const activity = baseActivity({
      category: 'cafes',
      on_the_bar: [{ name: 'Flat white', price: '€2.80' }],
    });
    expect(uniqueSection(activity)).toEqual({
      shape: 'pills',
      heading: 'On the bar',
      items: ['Flat white'],
    });
  });

  it('Cafés: "On the bar" section omits when the list is empty', () => {
    const activity = baseActivity({ category: 'cafes', on_the_bar: [] });
    expect(uniqueSection(activity)).toBeUndefined();
  });

  // Round-2 fix: same blank-name guard as Restaurants' Popular dishes above.
  it('Cafés: drops an on-the-bar item whose name is blank, keeping its siblings', () => {
    const activity = baseActivity({
      category: 'cafes',
      on_the_bar: [
        { name: 'Flat white', price: '€2.80' },
        { name: '', price: '€3' },
      ],
    });
    expect(uniqueSection(activity)).toEqual({
      shape: 'pills',
      heading: 'On the bar',
      items: ['Flat white'],
    });
  });

  it('Cafés: "On the bar" section omits (0 survivors) when every name is blank', () => {
    const activity = baseActivity({
      category: 'cafes',
      on_the_bar: [
        { name: '', price: '€3' },
        { name: '   ', price: '€4' },
      ],
    });
    expect(uniqueSection(activity)).toBeUndefined();
  });
});

describe('tripadvisorEyebrow (§5b, extended by T6 — this *is* the Meta line slot for a Tripadvisor row)', () => {
  it('joins category · price level · distance when price_level is present and no subtype (subcategory absent)', () => {
    const activity = baseActivity({
      category: 'restaurants',
      tripadvisor: {
        rating_image_url: 'https://tripadvisor.example/bubble.png',
        review_count: 1204,
        web_url: 'https://tripadvisor.example/place',
        price_level: 'Mid Range',
      },
      reviews: [{ rating: 5, date: '1 June 2026', text: 'Great spot.' }],
    });
    expect(tripadvisorEyebrow(activity, '1.2 km away')).toBe('Restaurant · Mid Range · 1.2 km away');
  });

  // design-spec.md's exact Restaurants composition: `Restaurant · Fine
  // Dining · $$$ · 400 m` — category, subtype (from `subcategory`), price
  // level, distance, all four in order.
  it('T6: joins category · subtype · price level · distance for a Restaurants row with all four present', () => {
    const activity = {
      ...baseActivity({
        category: 'restaurants',
        tripadvisor: {
          rating_image_url: 'https://tripadvisor.example/bubble.png',
          review_count: 1204,
          web_url: 'https://tripadvisor.example/place',
          price_level: 'Mid Range',
        },
        reviews: [{ rating: 5, date: '1 June 2026', text: 'Great spot.' }],
      }),
      subcategory: 'fine_dining',
    };
    expect(tripadvisorEyebrow(activity, '400 m away')).toBe(
      'Restaurant · Fine Dining · Mid Range · 400 m away',
    );
  });

  // design-spec.md's exact Bars composition (`Bar · Cocktail Bar · 200 m`)
  // has no price-level segment at all — unlike Restaurants, whose stat grid
  // omission is explicitly justified by "price level already sits in the
  // meta line". A Bar's tripadvisor object can still carry `price_level` on
  // the wire (same shared type), so this must scope it out, not just rely
  // on the field being absent in practice.
  it('T6: omits price level for a Bars row even when tripadvisor.price_level is present', () => {
    const activity = {
      ...baseActivity({
        category: 'bars',
        tripadvisor: {
          rating_image_url: 'https://tripadvisor.example/bubble.png',
          review_count: 88,
          web_url: 'https://tripadvisor.example/place',
          price_level: 'Mid Range',
        },
        reviews: [{ rating: 5, date: '1 June 2026', text: 'Great spot.' }],
      }),
      subcategory: 'cocktail_bar',
    };
    expect(tripadvisorEyebrow(activity, '200 m away')).toBe('Bar · Cocktail Bar · 200 m away');
  });

  // Same rule for Cafés (`Café · Coffee Shop · 150 m`, per design-spec.md).
  it('T6: omits price level for a Cafés row even when tripadvisor.price_level is present', () => {
    const activity = {
      ...baseActivity({
        category: 'cafes',
        tripadvisor: {
          rating_image_url: 'https://tripadvisor.example/bubble.png',
          review_count: 45,
          web_url: 'https://tripadvisor.example/place',
          price_level: 'Cheap Eats',
        },
        reviews: [{ rating: 4, date: '3 May 2026', text: 'Great espresso.' }],
      }),
      subcategory: 'coffee_shop',
    };
    expect(tripadvisorEyebrow(activity, '150 m away')).toBe('Café · Coffee Shop · 150 m away');
  });

  it('omits price level from the line when absent (no dangling separator, never fabricated)', () => {
    const activity = baseActivity({
      category: 'bars',
      tripadvisor: {
        rating_image_url: 'https://tripadvisor.example/bubble.png',
        review_count: 88,
        web_url: 'https://tripadvisor.example/place',
      },
      reviews: [{ rating: 5, date: '1 June 2026', text: 'Great spot.' }],
    });
    expect(tripadvisorEyebrow(activity, '2.4 km away')).toBe('Bar · 2.4 km away');
  });

  it('omits subtype from the line when subcategory is empty (documented as common on Tripadvisor rows)', () => {
    const activity = baseActivity({
      category: 'restaurants',
      tripadvisor: {
        rating_image_url: 'https://tripadvisor.example/bubble.png',
        review_count: 1204,
        web_url: 'https://tripadvisor.example/place',
      },
      reviews: [{ rating: 5, date: '1 June 2026', text: 'Great spot.' }],
    });
    expect(tripadvisorEyebrow(activity, '1.2 km away')).toBe('Restaurant · 1.2 km away');
  });

  // tripadvisor-marks-require-reviews (T2): a review-less Tripadvisor row is
  // de-marked — the eyebrow is one of the gated surfaces, so it renders
  // nothing for it, same as a genuinely non-Tripadvisor row.
  it('is undefined for a de-marked (review-less) Tripadvisor row', () => {
    const activity = baseActivity({
      category: 'restaurants',
      tripadvisor: {
        rating_image_url: 'https://tripadvisor.example/bubble.png',
        review_count: 1204,
        web_url: 'https://tripadvisor.example/place',
      },
      // No `reviews` key.
    });
    expect(tripadvisorEyebrow(activity, '1.2 km away')).toBeUndefined();
  });

  it('is undefined for a non-Tripadvisor row (no eyebrow renders)', () => {
    const activity = baseActivity({ category: 'restaurants', cuisine: 'Serbian' });
    expect(tripadvisorEyebrow(activity, '1.2 km away')).toBeUndefined();
  });
});

describe('tripadvisorAddressLine (T4)', () => {
  it('joins address + city when both are present', () => {
    const activity = { ...baseActivity(undefined), address: 'Knez Mihailova 10', city: 'Belgrade' };
    expect(tripadvisorAddressLine(activity)).toBe('Knez Mihailova 10, Belgrade');
  });

  it('falls back to whichever field is present', () => {
    expect(tripadvisorAddressLine({ ...baseActivity(undefined), address: 'Knez Mihailova 10' })).toBe(
      'Knez Mihailova 10',
    );
    expect(tripadvisorAddressLine({ ...baseActivity(undefined), city: 'Belgrade' })).toBe('Belgrade');
  });

  it('is undefined when both are absent (row omitted, no dangling comma)', () => {
    expect(tripadvisorAddressLine(baseActivity(undefined))).toBeUndefined();
  });
});

// reviews-description-graceful-degrade T1: the single named gate for "does
// the Google Reviews section render" (score/reviews irrelevant — only the
// maps link is compliance-required) plus its companion "does it also show
// the aggregate score header" (needs the link AND both rating fields).
describe('googleReviewsSectionShown / googleReviewsScoreShown (T1)', () => {
  it('score only (no maps link): section stays hidden — no link, no compliance-safe render', () => {
    const activity = { ...baseActivity(undefined), rating: 4.5, review_count: 10, google_maps_uri: undefined };
    expect(googleReviewsSectionShown(activity)).toBe(false);
    expect(googleReviewsScoreShown(activity)).toBe(false);
  });

  it('reviews only (no maps link): section stays hidden', () => {
    const activity = {
      ...baseActivity(undefined),
      rating: 0,
      review_count: undefined,
      google_maps_uri: undefined,
      google_reviews: [
        { authorAttribution: { displayName: 'A', uri: 'https://x' }, rating: 5, text: 'Great.', date: '2026-01-01' },
      ],
    };
    expect(googleReviewsSectionShown(activity)).toBe(false);
    expect(googleReviewsScoreShown(activity)).toBe(false);
  });

  it('maps link only (no score, no reviews): section renders, no score header — the maps-link-only card', () => {
    const activity = {
      ...baseActivity(undefined),
      rating: 0,
      review_count: undefined,
      google_reviews: undefined,
      google_maps_uri: 'https://maps.google.com/place/x',
    };
    expect(googleReviewsSectionShown(activity)).toBe(true);
    expect(googleReviewsScoreShown(activity)).toBe(false);
  });

  it('all present: section renders with a score header', () => {
    const activity = {
      ...baseActivity(undefined),
      rating: 4.5,
      review_count: 128,
      google_reviews: [
        { authorAttribution: { displayName: 'A', uri: 'https://x' }, rating: 5, text: 'Great.', date: '2026-01-01' },
      ],
      google_maps_uri: 'https://maps.google.com/place/x',
    };
    expect(googleReviewsSectionShown(activity)).toBe(true);
    expect(googleReviewsScoreShown(activity)).toBe(true);
  });

  it('none present: section stays hidden', () => {
    const activity = {
      ...baseActivity(undefined),
      rating: 0,
      review_count: undefined,
      google_reviews: undefined,
      google_maps_uri: undefined,
    };
    expect(googleReviewsSectionShown(activity)).toBe(false);
    expect(googleReviewsScoreShown(activity)).toBe(false);
  });

  it('rating present but review_count undefined (maps link present): section renders, score header does not', () => {
    const activity = {
      ...baseActivity(undefined),
      rating: 4.5,
      review_count: undefined,
      google_maps_uri: 'https://maps.google.com/place/x',
    };
    expect(googleReviewsSectionShown(activity)).toBe(true);
    expect(googleReviewsScoreShown(activity)).toBe(false);
  });

  it('empty google_reviews array (maps link present, no score): section still renders, no score header', () => {
    const activity = {
      ...baseActivity(undefined),
      rating: 0,
      review_count: undefined,
      google_reviews: [],
      google_maps_uri: 'https://maps.google.com/place/x',
    };
    expect(googleReviewsSectionShown(activity)).toBe(true);
    expect(googleReviewsScoreShown(activity)).toBe(false);
  });
});

// T5: replaces the retired BODY_SECTION_ORDER's 13 hand-maintained arrays —
// design-spec.md's "Screen composition" canonical order plus the single
// promote-above-stat-grid rule ("that is the entire per-category layout
// freedom"). The *promoted* slot named per category below reproduces
// exactly what each category's old per-category array already promoted
// (T5 carries the promotion choice over unchanged; T6-T10 decide final
// composition). The rest of the row is data-driven, not carried over
// verbatim: unlike the old arrays, this table can't structurally exclude a
// slot, so Nightlife and Sport (whose old arrays never listed
// 'description') now render it when Places prose is present, and
// Shopping's 'unique'/'factstrip' order is now the fixed canonical order
// instead of the old array's reversed pair — see engineering-notes.md's T5
// entry for the full disclosure (also covers Nightlife, flagged in round 1).
describe('bodySectionOrder — canonical order + single promote-above-stat-grid (T5)', () => {
  it('returns the canonical [factstrip, description, unique, goodtoknow] order for a category with no configured promotion', () => {
    for (const category of [
      'restaurants',
      'bars',
      'nature',
      'wellness',
      'entertainment',
      'tours_experiences',
    ] as const) {
      expect(bodySectionOrder(category)).toEqual(['factstrip', 'description', 'unique', 'goodtoknow']);
    }
  });

  it('promotes the configured slot above the stat grid, keeping the rest of the canonical order after it', () => {
    expect(bodySectionOrder('cafes')).toEqual(['description', 'factstrip', 'unique', 'goodtoknow']);
    expect(bodySectionOrder('nightlife')).toEqual(['unique', 'factstrip', 'description', 'goodtoknow']);
    expect(bodySectionOrder('sport')).toEqual(['difficulty', 'factstrip', 'description', 'unique', 'goodtoknow']);
    // T8: Kids' promotion is a no-op on the rendered order (its stat grid is
    // always empty — see `factStripFields`'s `kids` case), but the table
    // states it explicitly per the spec rather than relying on that side
    // effect — see the promotion table's own comment in activityDetailConfig.ts.
    expect(bodySectionOrder('kids')).toEqual(['description', 'factstrip', 'unique', 'goodtoknow']);
    expect(bodySectionOrder('culture')).toEqual(['unique', 'factstrip', 'description', 'goodtoknow']);
    expect(bodySectionOrder('art')).toEqual(['unique', 'factstrip', 'description', 'goodtoknow']);
    expect(bodySectionOrder('shopping')).toEqual(['description', 'factstrip', 'unique', 'goodtoknow']);
  });
});

// T5: badgeQualifier's 9-branch switch is retired — subtype now comes from
// the taxonomy-validated `subcategory` slug alone, never a generated field.
describe('subtypeLabel / metaLineLeadItems — subcategory-from-slug (T5)', () => {
  it('translates a valid subcategory slug to its taxonomy label', () => {
    const restaurant = { ...baseActivity({ category: 'restaurants' }), subcategory: 'fine_dining' };
    expect(subtypeLabel(restaurant)).toBe('Fine Dining');
    expect(metaLineLeadItems(restaurant)).toEqual(['Restaurant', 'Fine Dining']);
  });

  // This exact case — empty subcategory, no crash, no double-dot — is
  // documented as common on the three Tripadvisor categories (whose
  // subtype is only set when the per-venue Google name lookup succeeds).
  // No fallback subtype is invented; the retired generated qualifier isn't
  // resurrected as a stand-in.
  it('reads as category noun + remaining items with no invented fallback when subcategory is empty', () => {
    const noSubtype = baseActivity({ category: 'restaurants' });
    expect(subtypeLabel(noSubtype)).toBeUndefined();
    expect(metaLineLeadItems(noSubtype)).toEqual(['Restaurant', undefined]);
  });

  it('also reads as absent for an explicit empty-string subcategory (the wire\'s "unset" value)', () => {
    const emptySubtype = { ...baseActivity({ category: 'restaurants' }), subcategory: '' };
    expect(subtypeLabel(emptySubtype)).toBeUndefined();
  });

  it('is undefined (not a crash) for a slug that does not belong to the taxonomy', () => {
    const badSlug = { ...baseActivity({ category: 'restaurants' }), subcategory: 'not-a-real-slug' };
    expect(subtypeLabel(badSlug)).toBeUndefined();
  });

  // T5 round-2 fix: `activity.category` comes off an unvalidated wire cast
  // (api/activities.ts), so a backend-first category add with no
  // `SUBCATEGORIES` entry yet must degrade, not crash the whole screen —
  // mirrors the retired `badgeQualifier` switch's `default:` case.
  it('is undefined (not a crash) for a category the app taxonomy does not recognize', () => {
    const unknownCategory = {
      ...baseActivity({ category: 'restaurants' }),
      category: 'not_a_real_category' as never,
      subcategory: 'anything',
    };
    expect(subtypeLabel(unknownCategory)).toBeUndefined();
  });
});

// T8: Kids' meta line places "Ages X–Y" before distance (`Kids · Playground
// · Ages 3–10 · 600 m`) — the one meta-line item that must go through
// `classifyField` itself rather than lean on MetaLine's own `items` prop,
// since `items` only ever appends after distance.
describe('kidsAgeLabel (T8)', () => {
  it('renders "Ages X–Y" for a valid age_range', () => {
    const activity = baseActivity({ category: 'kids', age_range: '3-10' });
    expect(kidsAgeLabel(activity)).toBe('Ages 3-10');
  });

  it('omits the line when age_range is absent', () => {
    const activity = baseActivity({ category: 'kids' });
    expect(kidsAgeLabel(activity)).toBeUndefined();
  });

  it('omits the line when age_range fails its scalar shape (denylist hedge)', () => {
    const activity = baseActivity({ category: 'kids', age_range: 'Not specified' });
    expect(kidsAgeLabel(activity)).toBeUndefined();
  });

  it('is undefined for a category with no age_range field at all', () => {
    const activity = baseActivity({ category: 'culture' });
    expect(kidsAgeLabel(activity)).toBeUndefined();
  });
});

// T8: Culture's (and T9's Shopping's) shared "Venue only when it differs
// from the subtype" conditional — the comparison direction is the easy part
// to get backwards, so both directions get their own case.
describe('venueDiffersFromSubtype (T8)', () => {
  it('shows the venue value when it differs from the subtype label', () => {
    const activity = { ...baseActivity({ category: 'culture' }), subcategory: 'historical_site' };
    expect(subtypeLabel(activity)).toBe('Historical Site');
    expect(venueDiffersFromSubtype(activity, 'Fortress')).toBe('Fortress');
  });

  it('hides the venue value when it matches the subtype label exactly', () => {
    const activity = { ...baseActivity({ category: 'art' }), subcategory: 'art_museum' };
    expect(subtypeLabel(activity)).toBe('Art Museum');
    expect(venueDiffersFromSubtype(activity, 'Art Museum')).toBeUndefined();
  });

  it('hides the venue value when it matches the subtype label case/whitespace-insensitively', () => {
    const activity = { ...baseActivity({ category: 'art' }), subcategory: 'art_museum' };
    expect(venueDiffersFromSubtype(activity, '  art museum  ')).toBeUndefined();
  });

  it('shows the venue value when there is no subtype to compare against', () => {
    const activity = baseActivity({ category: 'culture' });
    expect(subtypeLabel(activity)).toBeUndefined();
    expect(venueDiffersFromSubtype(activity, 'Fortress')).toBe('Fortress');
  });

  it('is undefined when the venue value itself is absent, regardless of subtype', () => {
    const activity = { ...baseActivity({ category: 'culture' }), subcategory: 'historical_site' };
    expect(venueDiffersFromSubtype(activity, undefined)).toBeUndefined();
  });
});

describe('factStripFields — Kids/Culture/Art (T8)', () => {
  it('Kids has no stat grid at all, even with age_range/facilities present', () => {
    const activity = baseActivity({
      category: 'kids',
      age_range: '3-10',
      facilities: ['Parking', 'Restrooms'],
    });
    expect(factStripFields(activity)).toEqual([]);
  });

  // T2: Culture's `Tickets` chip (`ticket_price`) is retired — LLM-scraped,
  // not verifiable. Only `Venue` (differs-from-subtype) can survive now.
  it('Culture shows only Venue when it differs from the subtype (no Tickets chip, even when ticket_price is present)', () => {
    const activity = {
      ...baseActivity({ category: 'culture', venue_type: 'Fortress', ticket_price: '€10' }),
      subcategory: 'historical_site',
    };
    const labels = factStripFields(activity).map((f) => f.label);
    expect(labels).toEqual(['Venue']);
  });

  it('Culture has 0 chips (grid omits) when Venue matches the subtype', () => {
    const activity = {
      ...baseActivity({ category: 'culture', venue_type: 'Historical Site', ticket_price: '€10' }),
      subcategory: 'historical_site',
    };
    expect(factStripFields(activity)).toEqual([]);
  });

  // T2: Art's only chip (`Tickets`/`ticket_price`) is retired. Art never
  // has a chip of its own now (venue_type isn't a chip for Art either —
  // unchanged from before this task).
  it('Art has 0 chips (grid omits) even with ticket_price and a differing venue_type present', () => {
    const activity = {
      ...baseActivity({ category: 'art', venue_type: 'Museum', ticket_price: '€6' }),
      subcategory: 'art_museum',
    };
    expect(factStripFields(activity)).toEqual([]);
  });
});

// T2: both chips are retired for both categories (Typical visit/Typical
// show — LLM-scraped duration; Price from — LLM-scraped price). Wellness
// and Entertainment now never have a stat grid, regardless of what the
// legacy `details` payload still carries (a pre-T1 row can still have these
// fields set — see the "legacy data" regression coverage further down).
describe('factStripFields — wellness/entertainment (T2: no stat grid, ever)', () => {
  it('renders no chips for wellness even when typical_visit/price_from are present', () => {
    const activity = baseActivity({
      category: 'wellness',
      typical_visit: '2–3 hrs',
      price_from: 'from €22',
    });
    expect(factStripFields(activity)).toEqual([]);
  });

  it('omits wellness chips entirely when no data is present', () => {
    const activity = baseActivity({ category: 'wellness' });
    expect(factStripFields(activity)).toEqual([]);
  });

  it('renders no chips for entertainment even when typical_show_length/price_from are present', () => {
    const activity = baseActivity({
      category: 'entertainment',
      typical_show_length: '2 hrs',
      price_from: 'from €12',
    });
    expect(factStripFields(activity)).toEqual([]);
  });

  // T4 (activity-detail-system): superseded by HoursRow — usable structured
  // opening_hours no longer appends anything to the fact strip for any
  // category (moved out to its own slot, see HoursRow.test.tsx).
  describe('Hours never appends to the fact strip when opening_hours is usable', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(MONDAY_NOON_UTC);
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('does not append an Hours chip for wellness', () => {
      const activity = baseActivity({
        category: 'wellness',
        opening_hours: {
          timezone: 'UTC',
          periods: [{ day: 'monday', open: '09:00', close: '17:00' }],
        },
      });
      expect(factStripFields(activity).some((f) => f.label === '09:00–17:00')).toBe(false);
    });

    it('does not append an Hours chip for entertainment', () => {
      const activity = baseActivity({
        category: 'entertainment',
        opening_hours: {
          timezone: 'UTC',
          periods: [{ day: 'monday', open: '10:00', close: '23:00' }],
        },
      });
      expect(factStripFields(activity).some((f) => f.label === '10:00–23:00')).toBe(false);
    });
  });
});

describe('factStripFields — tours_experiences (T10)', () => {
  it('includes Duration, Group size, and Languages chips', () => {
    const activity = baseActivity({
      category: 'tours_experiences',
      duration: '2 h 30 min',
      group_size: 'Max 12',
      languages: 'EN, SR',
    });
    const chips = factStripFields(activity);
    expect(chips.map((f) => f.label)).toEqual(['Duration', 'Group size', 'Languages']);
    expect(chips.map((f) => f.value)).toEqual(['2 h 30 min', 'Max 12', 'EN, SR']);
  });

  it('omits chips entirely when no data is present', () => {
    const activity = baseActivity({ category: 'tours_experiences' });
    expect(factStripFields(activity)).toEqual([]);
  });
});

// T9: same "differs from the subtype" conditional the spec names for
// Culture (T8) — reuses `venueDiffersFromSubtype` rather than a re-derived
// copy (see the `venueDiffersFromSubtype (T8)` describe block above for the
// absent-subtype/whitespace/case-insensitivity coverage shared by both
// categories). Mirrors the "Kids/Culture/Art (T8)" describe block's two
// cases, plus Shopping's own `Best day` leading the row.
describe('factStripFields — shopping Venue (differs-from-subtype, T9)', () => {
  it('shows Best day and Venue (differs from subtype), Best day leading', () => {
    const activity = {
      ...baseActivity({ category: 'shopping', venue_type: 'Grocery Store', best_day: 'Saturday' }),
      subcategory: 'market_bazaar', // label: "Market/Bazaar"
    };
    const labels = factStripFields(activity).map((f) => f.label);
    expect(labels).toEqual(['Best day', 'Venue']);
    expect(factStripFields(activity).find((f) => f.label === 'Venue')?.value).toBe('Grocery Store');
  });

  it('omits Venue when it matches the subtype, keeping Best day', () => {
    const activity = {
      ...baseActivity({ category: 'shopping', venue_type: 'boutique', best_day: 'Friday' }),
      subcategory: 'boutique', // label: "Boutique"
    };
    const labels = factStripFields(activity).map((f) => f.label);
    expect(labels).toEqual(['Best day']);
  });
});

describe('goodToKnowSection', () => {
  it('renders a checklist for wellness when good_to_know is present', () => {
    const activity = baseActivity({
      category: 'wellness',
      good_to_know: ['Book ahead on weekends'],
    });
    expect(goodToKnowSection(activity)).toEqual({
      shape: 'checklist',
      heading: 'Good to know',
      items: ['Book ahead on weekends'],
    });
  });

  it('is undefined when good_to_know is absent', () => {
    const activity = baseActivity({ category: 'wellness' });
    expect(goodToKnowSection(activity)).toBeUndefined();
  });

  it('renders a checklist for entertainment too', () => {
    const activity = baseActivity({
      category: 'entertainment',
      good_to_know: ['Unnumbered seating — arrive early'],
    });
    expect(goodToKnowSection(activity)).toEqual({
      shape: 'checklist',
      heading: 'Good to know',
      items: ['Unnumbered seating — arrive early'],
    });
  });

  it('is undefined for a category with no good_to_know field at all (e.g. restaurants)', () => {
    const activity = baseActivity({ category: 'restaurants' });
    expect(goodToKnowSection(activity)).toBeUndefined();
  });

  // T9: this function ran zero validation before this task — every item now
  // goes through `classifyField('phrase', …)`, same contract as Pills/other
  // phrase-kind slots. Uses a genuinely shape-violating example (denylisted
  // Serbian placeholder), not the bug report's own good_to_know string —
  // see engineering-notes.md's T9 entry for why that exact string isn't a
  // usable test case for this guard.
  it('drops a denylisted item, keeping the rest of the list', () => {
    const activity = baseActivity({
      category: 'wellness',
      good_to_know: ['nije poznato', 'Book ahead on weekends'],
    });
    expect(goodToKnowSection(activity)).toEqual({
      shape: 'checklist',
      heading: 'Good to know',
      items: ['Book ahead on weekends'],
    });
  });

  it('drops an item over the phrase kind\'s 80-char limit', () => {
    const overLong = 'A'.repeat(81);
    const activity = baseActivity({
      category: 'entertainment',
      good_to_know: [overLong, 'Doors open 30 minutes before showtime'],
    });
    expect(goodToKnowSection(activity)).toEqual({
      shape: 'checklist',
      heading: 'Good to know',
      items: ['Doors open 30 minutes before showtime'],
    });
  });

  it('omits the whole section when every item fails classification', () => {
    const activity = baseActivity({
      category: 'wellness',
      good_to_know: ['nije poznato', 'nema podataka'],
    });
    expect(goodToKnowSection(activity)).toBeUndefined();
  });
});

// T7: design-spec.md's Nightlife/Nature/Sport stat-grid compositions.
// Per-value scalar classification is FactStrip's own job (see
// FactStrip.test.tsx's classifyFactChips coverage) — this only pins which
// fields each category surfaces, matching "The 13 screens".
describe('factStripFields — nightlife/nature/sport (T7)', () => {
  // T2: the `Entry` chip (`entry_price`) is retired — LLM-scraped, not
  // verifiable — even when the legacy field is present.
  it('surfaces only Dress code, Opens for nightlife (no Entry chip)', () => {
    const activity = baseActivity({
      category: 'nightlife',
      entry_price: '€10',
      dress_code: 'Smart casual',
      opens_time: '23:00',
    });
    const labels = factStripFields(activity).map((f) => f.label);
    expect(labels).toEqual(['Dress code', 'Opens']);
  });

  it('omits nightlife chips entirely when no data is present', () => {
    const activity = baseActivity({ category: 'nightlife' });
    expect(factStripFields(activity)).toEqual([]);
  });

  it('surfaces Time to spend, Best time, Cost for nature', () => {
    const activity = baseActivity({
      category: 'nature',
      time_to_spend: '2 h',
      best_time: 'Morning',
      cost: 'Free',
    });
    const labels = factStripFields(activity).map((f) => f.label);
    expect(labels).toEqual(['Time to spend', 'Best time', 'Cost']);
  });

  it('omits nature chips entirely when no data is present', () => {
    const activity = baseActivity({ category: 'nature' });
    expect(factStripFields(activity)).toEqual([]);
  });

  // T2: the `Duration` chip (`d.duration`, the LLM-scraped session
  // duration) is retired — even when the legacy field is present.
  it('surfaces only Effort, Gear for sport (no Duration chip)', () => {
    const activity = baseActivity({
      category: 'sport',
      effort_level: 'Moderate',
      duration: '2 h',
      gear: 'Boots',
    });
    const labels = factStripFields(activity).map((f) => f.label);
    expect(labels).toEqual(['Effort', 'Gear']);
  });

  it('omits sport chips entirely when no data is present', () => {
    const activity = baseActivity({ category: 'sport' });
    expect(factStripFields(activity)).toEqual([]);
  });
});

// T7: design-spec.md's Nightlife "Tonight" (compact), Nature/Sport "Good to
// know"/"What to bring" (checklist) unique sections.
describe('uniqueSection — nightlife/nature/sport (T7)', () => {
  it('builds the Tonight compact-density schedule from nightlife lineup', () => {
    const activity = baseActivity({
      category: 'nightlife',
      lineup: [{ time: '22:00', act: 'DJ Set', stage: 'Main' }],
    });
    expect(uniqueSection(activity)).toEqual({
      shape: 'schedule',
      heading: 'Tonight',
      density: 'compact',
      rows: [{ leading: '22:00', main: 'DJ Set', trailing: 'Main' }],
    });
  });

  it('is undefined when nightlife has no lineup', () => {
    const activity = baseActivity({ category: 'nightlife' });
    expect(uniqueSection(activity)).toBeUndefined();
  });

  it('builds the "Good to know" checklist from nature good_to_know', () => {
    const activity = baseActivity({
      category: 'nature',
      good_to_know: ['Bring water', 'Trail closes at dusk'],
    });
    expect(uniqueSection(activity)).toEqual({
      shape: 'checklist',
      heading: 'Good to know',
      items: ['Bring water', 'Trail closes at dusk'],
    });
  });

  it('is undefined when nature has no good_to_know', () => {
    const activity = baseActivity({ category: 'nature' });
    expect(uniqueSection(activity)).toBeUndefined();
  });

  it('builds the "What to bring" checklist from sport what_to_bring', () => {
    const activity = baseActivity({
      category: 'sport',
      what_to_bring: ['Climbing shoes', 'Chalk bag'],
    });
    expect(uniqueSection(activity)).toEqual({
      shape: 'checklist',
      heading: 'What to bring',
      items: ['Climbing shoes', 'Chalk bag'],
    });
  });

  it('is undefined when sport has no what_to_bring', () => {
    const activity = baseActivity({ category: 'sport' });
    expect(uniqueSection(activity)).toBeUndefined();
  });
});

// T7 cross-check: the spec is explicit that the difficulty meter is Sport's
// alone ("no category shows both" it and Tours' level chip) — pins that at
// the promote-mechanism level, alongside ActivityDetailScreen.test.tsx's
// render-level check. The AC's other half ("Tours & Experiences uses the
// level chip instead") isn't asserted here or anywhere in T7: Tours has no
// `ActivityDetails` variant / screen composition yet (T10's job, a separate
// concurrent task). T10 (PR #134) owns that assertion directly — its Tours
// composition test asserts `queryByLabelText(/^Difficulty:/)` is null on a
// Tours row rendering the level chip — so it isn't duplicated here.
describe('difficulty meter exclusivity — Sport only (T7 cross-check)', () => {
  it('is the promoted slot for sport and never appears in any other category\'s body order', () => {
    // Derived from the actual category list (not hand-written) so a 14th
    // category added to `Category` can't silently skip this assertion —
    // `CATEGORY_LABELS` is `Record<Category, string>`, exhaustive by
    // construction (filters.ts).
    const allCategories = Object.keys(CATEGORY_LABELS) as Category[];
    for (const category of allCategories) {
      expect(bodySectionOrder(category).includes('difficulty')).toBe(category === 'sport');
    }
  });
});

// design-spec.md's "Bottom bar" slot (§B12): optional price-context line —
// wired for Entertainment (`price_from`) and, per T7, Nightlife
// (`entry_price`, spec's "Bottom: `From €10` + `Guest list`"). Wellness
// explicitly does NOT get this line (T9: "external-booking note + Visit
// website"; `price_from` surfaces only in the stat grid) — a price line
// there would double the same figure.
describe('uniqueSection — entertainment upcoming shows (dateblock)', () => {
  it('builds a title-only row — no subline field at all, even when a legacy time_or_price value is present', () => {
    // T2: legacy-data regression — a pre-T1 row can still carry
    // `time_or_price` on the wire (backend keeps old JSON as-is). The row
    // must render title-only regardless; `subline` no longer exists on
    // `DateBlockRow` at all, so there's no field for it to leak into.
    const activity = baseActivity({
      category: 'entertainment',
      upcoming_shows: [{ date: '2024-06-01', title: 'Live jazz night', time_or_price: '€15' }],
    });
    const section = uniqueSection(activity);
    expect(section?.shape).toBe('schedule');
    if (section?.shape !== 'schedule') throw new Error('expected schedule shape');
    expect(section.rows[0]).toMatchObject({ title: 'Live jazz night' });
    expect(section.rows[0]).not.toHaveProperty('subline');
  });

  // T9 round-3 fix: an unparseable `date` is still an LLM-generated value —
  // a denylisted or over-length raw string must omit, not render verbatim
  // at numeral size. The row itself survives (title unaffected).
  it('omits the date block when the raw date is denylisted (production bug: 41/231 live rows)', () => {
    const activity = baseActivity({
      category: 'entertainment',
      upcoming_shows: [{ date: 'Not specified', title: 'Live jazz night' }],
    });
    const section = uniqueSection(activity);
    if (section?.shape !== 'schedule')
      throw new Error('expected schedule shape');
    expect(section.rows[0]).toMatchObject({ day: '', date: '', title: 'Live jazz night' });
  });

  it('omits the date block when the raw date fails the scalar shape (too long)', () => {
    const activity = baseActivity({
      category: 'entertainment',
      upcoming_shows: [
        {
          date: 'Details not provided for this listing',
          title: 'Live jazz night',
        },
      ],
    });
    const section = uniqueSection(activity);
    if (section?.shape !== 'schedule')
      throw new Error('expected schedule shape');
    expect(section.rows[0]).toMatchObject({ day: '', date: '' });
  });

  // T11 fix: a short unparseable-but-scalar-valid raw date ("TBA") used to
  // be forced into `date` (the 44px numeral column), which crushed longer
  // examples of this same shape ("Q4 2026") into a couple of glyphs. It now
  // goes to `dateLabel` instead — `date`/`day` stay empty, so the row's
  // structured date-block box omits, and the caller renders `dateLabel` as
  // an unstructured label in the row body.
  it('routes a short unparseable raw date to dateLabel, not the numeral column (e.g. "TBA")', () => {
    const activity = baseActivity({
      category: 'entertainment',
      upcoming_shows: [{ date: 'TBA', title: 'Live jazz night' }],
    });
    const section = uniqueSection(activity);
    if (section?.shape !== 'schedule')
      throw new Error('expected schedule shape');
    expect(section.rows[0]).toMatchObject({ day: '', date: '', dateLabel: 'TBA' });
  });

  it('routes a longer unparseable-but-scalar-valid raw date to dateLabel the same way (e.g. "Q4 2026")', () => {
    const activity = baseActivity({
      category: 'entertainment',
      upcoming_shows: [{ date: 'Q4 2026', title: 'Live jazz night' }],
    });
    const section = uniqueSection(activity);
    if (section?.shape !== 'schedule')
      throw new Error('expected schedule shape');
    expect(section.rows[0]).toMatchObject({ day: '', date: '', dateLabel: 'Q4 2026' });
  });
});

// design-spec.md's Tours & Experiences composition (T10).
describe('toursIncludedChecklist — What\'s included ✓/✗ (T10)', () => {
  it('splits included/not_included into items/crossItems, each classifyField(\'phrase\', …)d', () => {
    const activity = baseActivity({
      category: 'tours_experiences',
      included: ['Licensed local guide', 'Fortress grounds entry'],
      not_included: ['Museum tickets', 'Food and drink'],
    });
    expect(toursIncludedChecklist(activity)).toEqual({
      shape: 'checklist',
      heading: "What's included",
      items: ['Licensed local guide', 'Fortress grounds entry'],
      crossItems: ['Museum tickets', 'Food and drink'],
    });
  });

  it('drops an individual item failing the phrase contract (>80 chars) without dropping its siblings', () => {
    const tooLong = 'x'.repeat(81);
    const activity = baseActivity({
      category: 'tours_experiences',
      included: ['Licensed local guide', tooLong],
      not_included: [],
    });
    const section = toursIncludedChecklist(activity);
    if (section?.shape !== 'checklist') throw new Error('expected checklist shape');
    expect(section.items).toEqual(['Licensed local guide']);
  });

  it('drops a denylisted item (leaked hedge)', () => {
    const activity = baseActivity({
      category: 'tours_experiences',
      included: ['Not specified'],
      not_included: ['Museum tickets'],
    });
    const section = toursIncludedChecklist(activity);
    if (section?.shape !== 'checklist') throw new Error('expected checklist shape');
    expect(section.items).toEqual([]);
    expect(section.crossItems).toEqual(['Museum tickets']);
  });

  it('is undefined (0 survivors omits the section) when both lists are absent', () => {
    const activity = baseActivity({ category: 'tours_experiences' });
    expect(toursIncludedChecklist(activity)).toBeUndefined();
  });

  it('is undefined when both lists are present but every item fails its kind', () => {
    const activity = baseActivity({
      category: 'tours_experiences',
      included: ['Not specified'],
      not_included: ['n/a'],
    });
    expect(toursIncludedChecklist(activity)).toBeUndefined();
  });

  it('is undefined for a non-Tours category', () => {
    const activity = baseActivity({ category: 'restaurants' });
    expect(toursIncludedChecklist(activity)).toBeUndefined();
  });
});

describe('toursItinerary — numbered compact rows (T10)', () => {
  it('numbers each surviving stop, leading 1-based', () => {
    const activity = baseActivity({
      category: 'tours_experiences',
      itinerary: ['Fortress', 'Bazaar quarter', 'Riverfront market'],
    });
    expect(toursItinerary(activity)).toEqual({
      shape: 'schedule',
      heading: 'Itinerary',
      density: 'compact',
      rows: [
        { leading: '1', main: 'Fortress', leadingStyle: 'number' },
        { leading: '2', main: 'Bazaar quarter', leadingStyle: 'number' },
        { leading: '3', main: 'Riverfront market', leadingStyle: 'number' },
      ],
    });
  });

  it('drops a stop failing the phrase contract and renumbers the survivors', () => {
    const activity = baseActivity({
      category: 'tours_experiences',
      itinerary: ['Fortress', 'Not specified', 'Riverfront market'],
    });
    const section = toursItinerary(activity);
    if (section?.shape !== 'schedule') throw new Error('expected schedule shape');
    expect(section.rows).toEqual([
      { leading: '1', main: 'Fortress', leadingStyle: 'number' },
      { leading: '2', main: 'Riverfront market', leadingStyle: 'number' },
    ]);
  });

  it('is undefined (0 survivors omits the section) when itinerary is absent', () => {
    const activity = baseActivity({ category: 'tours_experiences' });
    expect(toursItinerary(activity)).toBeUndefined();
  });
});

describe('toursMeetingPoint (T10)', () => {
  it('classifies meeting_point as prose (no length rejection)', () => {
    const longAddress =
      'Republic Square, by the horse statue — enter through the northern gate and look for the guide holding a red umbrella.';
    const activity = baseActivity({ category: 'tours_experiences', meeting_point: longAddress });
    expect(toursMeetingPoint(activity)).toBe(longAddress);
  });

  it('is undefined when meeting_point is denylisted', () => {
    const activity = baseActivity({ category: 'tours_experiences', meeting_point: 'Not specified' });
    expect(toursMeetingPoint(activity)).toBeUndefined();
  });

  it('is undefined when meeting_point is absent', () => {
    const activity = baseActivity({ category: 'tours_experiences' });
    expect(toursMeetingPoint(activity)).toBeUndefined();
  });
});

describe('metaDistanceText — Tours prefixes "Meets" (T10)', () => {
  it('reads "Meets <n> km away" for tours_experiences with a distance anchor', () => {
    const activity = { ...baseActivity({ category: 'tours_experiences' }), distance_km: 0.4 };
    expect(metaDistanceText(activity, true)).toBe('Meets 0.4 km away');
  });

  it('reads plain "<n> km away" for every other category', () => {
    const activity = { ...baseActivity({ category: 'restaurants' }), distance_km: 0.4 };
    expect(metaDistanceText(activity, true)).toBe('0.4 km away');
  });

  it('reads the country, with no "Meets" prefix, for Anywhere scope (no distance anchor)', () => {
    const activity = { ...baseActivity({ category: 'tours_experiences' }), country: 'Serbia' };
    expect(metaDistanceText(activity, false)).toBe('Serbia');
  });
});

// T9: Treatments switches from the generic "compact" density to the new
// "duration" density (name / duration / `from €X`) — the UI rendering
// itself is covered by UniqueSection.test.tsx; this covers the mapping
// (classifyField wiring + the "from " prefix) that feeds it.
// T2: Treatments moved from the retired "duration" density (name + duration
// + `from €X`) to pills, name only. `duration`/`price` are both dropped at
// this mapping layer — an LLM-scraped duration is exactly the production
// bug this task exists to fix.
describe('uniqueSection — wellness treatments (pills, T2)', () => {
  it('maps each surviving item name to a pill, dropping duration/price even when present', () => {
    const activity = baseActivity({
      category: 'wellness',
      treatments: [
        { item: 'Swedish massage', duration: '60 min', price: '€35' },
        { item: 'Deep tissue massage' },
      ],
    });
    expect(uniqueSection(activity)).toEqual({
      shape: 'pills',
      heading: 'Treatments',
      items: ['Swedish massage', 'Deep tissue massage'],
    });
  });

  // Partial survivor: one item's name fails the phrase contract (denylisted
  // hedge, same surface the production bug leaked from), the rest render.
  it('drops a treatment whose name is denylisted, keeping its siblings', () => {
    const activity = baseActivity({
      category: 'wellness',
      treatments: [{ item: 'Swedish massage' }, { item: 'Nije navedeno' }],
    });
    expect(uniqueSection(activity)).toEqual({
      shape: 'pills',
      heading: 'Treatments',
      items: ['Swedish massage'],
    });
  });

  it('is undefined when there are no treatments', () => {
    const activity = baseActivity({ category: 'wellness' });
    expect(uniqueSection(activity)).toBeUndefined();
  });

  it('is undefined (0 survivors omits the section) when every item name fails classification', () => {
    const activity = baseActivity({
      category: 'wellness',
      treatments: [{ item: 'Nije navedeno' }],
    });
    expect(uniqueSection(activity)).toBeUndefined();
  });
});
