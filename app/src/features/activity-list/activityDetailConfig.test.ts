import type { Activity, OpeningHours } from '../../api/activities';
import { openStatus, todayHoursRow, weekView } from './activityDetailConfig';

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
