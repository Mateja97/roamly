import { Clock } from 'lucide-react-native';
import type { Activity, OpeningHours } from '../../api/activities';
import {
  bodySectionOrder,
  factStripFields,
  goodToKnowSection,
  metaLineLeadItems,
  openStatus,
  priceContextLine,
  subtypeLabel,
  todayHoursRow,
  tripadvisorAddressLine,
  tripadvisorAttribution,
  tripadvisorEyebrow,
  tripadvisorReviews,
  weekView,
} from './activityDetailConfig';

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

describe('openStatus — structured opening_hours', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(MONDAY_NOON_UTC);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads Open for a same-day period covering the current venue-local time', () => {
    const activity = baseActivity({
      category: 'cafes',
      opening_hours: {
        timezone: 'UTC',
        periods: [{ day: 'monday', open: '09:00', close: '17:00' }],
      },
    });
    expect(openStatus(activity)).toEqual({ text: 'Open', isOpen: true });
  });

  it('reads Closed outside all periods (muted, not error state — isOpen false)', () => {
    const activity = baseActivity({
      category: 'cafes',
      opening_hours: {
        timezone: 'UTC',
        periods: [{ day: 'monday', open: '13:00', close: '17:00' }],
      },
    });
    expect(openStatus(activity)).toEqual({ text: 'Closed', isOpen: false });
  });

  it('reads Open at 01:00 venue-local for a past-midnight 20:00-02:00 period', () => {
    // Sunday 20:00-02:00 UTC covers Monday 01:00 UTC (the day before "now").
    jest.setSystemTime(new Date('2024-01-01T01:00:00Z'));
    const activity = baseActivity({
      category: 'bars',
      opening_hours: {
        timezone: 'UTC',
        periods: [{ day: 'sunday', open: '20:00', close: '02:00' }],
      },
    });
    expect(openStatus(activity)).toEqual({ text: 'Open', isOpen: true });
  });

  it('reads Closed past the rollover close time (02:30 venue-local)', () => {
    jest.setSystemTime(new Date('2024-01-01T02:30:00Z'));
    const activity = baseActivity({
      category: 'bars',
      opening_hours: {
        timezone: 'UTC',
        periods: [{ day: 'sunday', open: '20:00', close: '02:00' }],
      },
    });
    expect(openStatus(activity)).toEqual({ text: 'Closed', isOpen: false });
  });

  it('always-open venue reads Open regardless of periods/time', () => {
    const activity = baseActivity({
      category: 'shopping',
      opening_hours: { timezone: 'UTC', always_open: true },
    });
    expect(openStatus(activity)).toEqual({ text: 'Open', isOpen: true });
  });

  it('computes in the venue IANA timezone, not UTC/device time', () => {
    // 2024-01-01T14:00:00Z is 09:00 in America/New_York (EST, UTC-5) —
    // inside a 08:00-10:00 Monday period there, even though it's 14:00 UTC.
    jest.setSystemTime(new Date('2024-01-01T14:00:00Z'));
    const activity = baseActivity({
      category: 'culture',
      opening_hours: {
        timezone: 'America/New_York',
        periods: [{ day: 'monday', open: '08:00', close: '10:00' }],
      },
    });
    expect(openStatus(activity)).toEqual({ text: 'Open', isOpen: true });
  });

  it('degrades to the fallback flag on an unresolvable timezone (no crash, no guess)', () => {
    const activity = baseActivity({
      category: 'restaurants',
      open_status: 'Open now',
      opening_hours: {
        timezone: 'Not/AZone',
        periods: [{ day: 'monday', open: '09:00', close: '17:00' }],
      },
    });
    expect(openStatus(activity)).toEqual({ text: 'Open now', isOpen: true });
  });

  it('degrades to no-status when opening_hours is malformed and no static flag exists', () => {
    const activity = baseActivity({
      category: 'art',
      opening_hours: { timezone: '' },
    });
    expect(openStatus(activity)).toBeUndefined();
  });

  it('supersedes the static open_status flag when opening_hours is present and usable', () => {
    const activity = baseActivity({
      category: 'restaurants',
      open_status: 'Closed',
      opening_hours: {
        timezone: 'UTC',
        periods: [{ day: 'monday', open: '09:00', close: '17:00' }],
      },
    });
    expect(openStatus(activity)).toEqual({ text: 'Open', isOpen: true });
  });

  it('supersedes nightlife\'s "tonight" wording with present-tense Open/Closed', () => {
    const activity = baseActivity({
      category: 'nightlife',
      open_tonight: false,
      opening_hours: {
        timezone: 'UTC',
        periods: [{ day: 'monday', open: '09:00', close: '17:00' }],
      },
    });
    expect(openStatus(activity)).toEqual({ text: 'Open', isOpen: true });
  });

  it('falls back to the static flag unchanged when no opening_hours object exists', () => {
    const activity = baseActivity({
      category: 'nightlife',
      open_tonight: true,
    });
    expect(openStatus(activity)).toEqual({ text: 'Open tonight', isOpen: true });
  });

  it('shows no status for a category with neither opening_hours nor a static flag', () => {
    const activity = baseActivity({ category: 'cafes' });
    expect(openStatus(activity)).toBeUndefined();
  });

  it('returns undefined for an activity with no details at all', () => {
    const activity = baseActivity(undefined);
    expect(openStatus(activity)).toBeUndefined();
  });
});

describe('weekView — flat periods to Monday-first week view', () => {
  it('orders Monday->Sunday regardless of the input periods order', () => {
    const oh: OpeningHours = {
      timezone: 'UTC',
      periods: [
        { day: 'sunday', open: '10:00', close: '14:00' },
        { day: 'monday', open: '09:00', close: '17:00' },
      ],
    };
    const rows = weekView(oh);
    expect(rows.map((row) => row.day)).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ]);
    expect(rows[0]).toEqual({ day: 'monday', hours: '09:00–17:00' });
    expect(rows[6]).toEqual({ day: 'sunday', hours: '10:00–14:00' });
  });

  it('lists a split-hours day ascending by start time, comma-joined', () => {
    const oh: OpeningHours = {
      timezone: 'UTC',
      periods: [
        { day: 'monday', open: '18:00', close: '22:00' },
        { day: 'monday', open: '09:00', close: '14:00' },
      ],
    };
    const monday = weekView(oh).find((row) => row.day === 'monday');
    expect(monday?.hours).toBe('09:00–14:00, 18:00–22:00');
  });

  it('reads "Closed" for a day with zero periods', () => {
    const oh: OpeningHours = {
      timezone: 'UTC',
      periods: [{ day: 'monday', open: '09:00', close: '17:00' }],
    };
    const tuesday = weekView(oh).find((row) => row.day === 'tuesday');
    expect(tuesday?.hours).toBe('Closed');
  });

  it('reads "Open 24 hours" for every day of an always_open venue', () => {
    const oh: OpeningHours = { timezone: 'UTC', always_open: true };
    expect(weekView(oh).every((row) => row.hours === 'Open 24 hours')).toBe(
      true,
    );
  });

  it('attributes a past-midnight period to its start day, not the day it ends on', () => {
    const oh: OpeningHours = {
      timezone: 'UTC',
      periods: [{ day: 'sunday', open: '20:00', close: '02:00' }],
    };
    const rows = weekView(oh);
    expect(rows.find((row) => row.day === 'sunday')?.hours).toBe(
      '20:00–02:00',
    );
    expect(rows.find((row) => row.day === 'monday')?.hours).toBe('Closed');
  });
});

describe('todayHoursRow — default-state today line', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(MONDAY_NOON_UTC);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the venue-local today entry when opening_hours is usable', () => {
    const activity = baseActivity({
      category: 'cafes',
      opening_hours: {
        timezone: 'UTC',
        periods: [{ day: 'monday', open: '09:00', close: '17:00' }],
      },
    });
    expect(todayHoursRow(activity)).toEqual({
      status: { text: 'Open', isOpen: true },
      weekday: 'Monday',
      hours: '09:00–17:00',
    });
  });

  it('reads "Closed today" when today has zero periods', () => {
    const activity = baseActivity({
      category: 'cafes',
      opening_hours: {
        timezone: 'UTC',
        periods: [{ day: 'tuesday', open: '09:00', close: '17:00' }],
      },
    });
    expect(todayHoursRow(activity)).toEqual({
      status: { text: 'Closed', isOpen: false },
      weekday: 'Monday',
      hours: 'Closed today',
    });
  });

  it('reads "Open 24 hours" for an always_open venue', () => {
    const activity = baseActivity({
      category: 'shopping',
      opening_hours: { timezone: 'UTC', always_open: true },
    });
    expect(todayHoursRow(activity)).toEqual({
      status: { text: 'Open', isOpen: true },
      weekday: 'Monday',
      hours: 'Open 24 hours',
    });
  });

  it('joins split hours ascending by start time in the detail line', () => {
    const activity = baseActivity({
      category: 'restaurants',
      opening_hours: {
        timezone: 'UTC',
        periods: [
          { day: 'monday', open: '18:00', close: '22:00' },
          { day: 'monday', open: '09:00', close: '14:00' },
        ],
      },
    });
    expect(todayHoursRow(activity)?.hours).toBe('09:00–14:00, 18:00–22:00');
  });

  it('degrades to undefined on an unresolvable timezone (falls back to the legacy chip)', () => {
    const activity = baseActivity({
      category: 'art',
      opening_hours: {
        timezone: 'Not/AZone',
        periods: [{ day: 'monday', open: '09:00', close: '17:00' }],
      },
    });
    expect(todayHoursRow(activity)).toBeUndefined();
  });

  it('degrades to undefined when there is no opening_hours at all', () => {
    const activity = baseActivity({
      category: 'nightlife',
      open_tonight: true,
    });
    expect(todayHoursRow(activity)).toBeUndefined();
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

  it('reads `tripadvisor` off a bar row too', () => {
    const activity = baseActivity({
      category: 'bars',
      tripadvisor: {
        rating_image_url: 'https://tripadvisor.example/bubble.png',
        review_count: 88,
        web_url: 'https://tripadvisor.example/place',
      },
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

describe('factStripFields — Tripadvisor rows drop Cuisine/Price (§5b eyebrow carries them instead)', () => {
  it('omits the Cuisine/Price chips for a Tripadvisor-sourced restaurant row, even when the legacy fields are populated', () => {
    const activity = baseActivity({
      category: 'restaurants',
      cuisine: 'Italian',
      price_tier: '€€',
      tripadvisor: {
        rating_image_url: 'https://tripadvisor.example/bubble.png',
        review_count: 1204,
        web_url: 'https://tripadvisor.example/place',
      },
    });
    const labels = factStripFields(activity).map((f) => f.label);
    expect(labels).not.toContain('Cuisine');
    expect(labels).not.toContain('Price');
  });

  it('keeps the Cuisine/Price chips for a non-Tripadvisor restaurant row, unchanged', () => {
    const activity = baseActivity({ category: 'restaurants', cuisine: 'Italian', price_tier: '€€' });
    const labels = factStripFields(activity).map((f) => f.label);
    expect(labels).toContain('Cuisine');
    expect(labels).toContain('Price');
  });
});

describe('tripadvisorEyebrow (§5b)', () => {
  it('joins category · price level · distance when price_level is present', () => {
    const activity = baseActivity({
      category: 'restaurants',
      tripadvisor: {
        rating_image_url: 'https://tripadvisor.example/bubble.png',
        review_count: 1204,
        web_url: 'https://tripadvisor.example/place',
        price_level: 'Mid Range',
      },
    });
    expect(tripadvisorEyebrow(activity, '1.2 km away')).toBe('Restaurant · Mid Range · 1.2 km away');
  });

  it('omits price level from the line when absent (no dangling separator, never fabricated)', () => {
    const activity = baseActivity({
      category: 'bars',
      tripadvisor: {
        rating_image_url: 'https://tripadvisor.example/bubble.png',
        review_count: 88,
        web_url: 'https://tripadvisor.example/place',
      },
    });
    expect(tripadvisorEyebrow(activity, '2.4 km away')).toBe('Bar · 2.4 km away');
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
      'kids',
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

describe('factStripFields — wellness/entertainment', () => {
  it('includes Typical visit and Price from chips for wellness', () => {
    const activity = baseActivity({
      category: 'wellness',
      typical_visit: '2–3 hrs',
      price_from: 'from €22',
    });
    const labels = factStripFields(activity).map((f) => f.label);
    expect(labels).toContain('Typical visit');
    expect(labels).toContain('Price from');
  });

  it('omits wellness chips entirely when no data is present', () => {
    const activity = baseActivity({ category: 'wellness' });
    expect(factStripFields(activity)).toEqual([]);
  });

  it('includes Typical show and Price from chips for entertainment', () => {
    const activity = baseActivity({
      category: 'entertainment',
      typical_show_length: '2 hrs',
      price_from: 'from €12',
    });
    const labels = factStripFields(activity).map((f) => f.label);
    expect(labels).toContain('Typical show');
    expect(labels).toContain('Price from');
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
});

// design-spec.md's "Bottom bar" slot (§B12): optional price-context line —
// wired for Entertainment today. Wellness explicitly does NOT get this line
// (T9: "external-booking note + Visit website"; `price_from` surfaces only
// in the stat grid) — a price line there would double the same figure.
describe('priceContextLine', () => {
  it('renders "From <price>" for entertainment when price_from is present', () => {
    const activity = baseActivity({ category: 'entertainment', price_from: '€8' });
    expect(priceContextLine(activity)).toBe('From €8');
  });

  it('omits the line when price_from is absent', () => {
    const activity = baseActivity({ category: 'entertainment' });
    expect(priceContextLine(activity)).toBeUndefined();
  });

  it('omits the line when price_from fails its scalar shape (the production-bug shape)', () => {
    const activity = baseActivity({
      category: 'entertainment',
      price_from: 'The starting price is not explicitly stated.',
    });
    expect(priceContextLine(activity)).toBeUndefined();
  });

  it('is undefined for wellness even when price_from is present (stat grid owns it there)', () => {
    const activity = baseActivity({ category: 'wellness', price_from: '€25' });
    expect(priceContextLine(activity)).toBeUndefined();
  });

  it('is undefined for a category with no price_from field at all (e.g. nightlife)', () => {
    const activity = baseActivity({ category: 'nightlife' });
    expect(priceContextLine(activity)).toBeUndefined();
  });
});
