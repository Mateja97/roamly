import type {
  Activity,
  ActivityDetails,
  DayOfWeek,
  OpeningHours,
  OpeningHoursPeriod,
} from '../../api/activities';

// The seven in-scope categories may carry a structured
// `opening_hours` object — this is the one place that reads it off the
// discriminated `ActivityDetails` union (mirrors `factStripFields`'s own
// per-category switch below).
function openingHoursOf(d: ActivityDetails): OpeningHours | undefined {
  switch (d.category) {
    case 'restaurants':
    case 'bars':
    case 'cafes':
    case 'nightlife':
    case 'culture':
    case 'art':
    case 'shopping':
    case 'wellness':
    case 'entertainment':
      return d.opening_hours;
    default:
      return undefined;
  }
}

const DAY_ORDER: DayOfWeek[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

// "HH:MM" (24h, backend-validated) -> minutes since midnight, or undefined
// on anything unparseable — never throws.
function hhmmToMinutes(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

// The venue's own current weekday + minute-of-day, read via `Intl` against
// the IANA `timezone` string — never the device's zone. `hourCycle: 'h23'`
// pins midnight to "00" (some engines otherwise report "24"). Returns
// undefined for a timezone `Intl` can't resolve, degrading the caller to
// the static-flag fallback rather than guessing.
function venueNow(timezone: string): { day: DayOfWeek; minutes: number } | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const weekday = parts
      .find((p) => p.type === 'weekday')
      ?.value.toLowerCase();
    const hour = parts.find((p) => p.type === 'hour')?.value;
    const minute = parts.find((p) => p.type === 'minute')?.value;
    if (!weekday || hour === undefined || minute === undefined) return undefined;
    if (!DAY_ORDER.includes(weekday as DayOfWeek)) return undefined;
    return { day: weekday as DayOfWeek, minutes: Number(hour) * 60 + Number(minute) };
  } catch {
    // Unresolvable IANA zone (malformed data) — no crash, caller falls back.
    return undefined;
  }
}

// A period is open for `now` either same-day (open <= now < close) or,
// when close <= open, rolling past midnight: open from `open` to midnight on
// its own day, then from midnight to `close` on the following day (e.g.
// 20:00-02:00 reads Open at 01:00 the next day).
function periodCoversNow(
  period: OpeningHoursPeriod,
  now: { day: DayOfWeek; minutes: number },
): boolean {
  const openMin = hhmmToMinutes(period.open);
  const closeMin = hhmmToMinutes(period.close);
  if (openMin === undefined || closeMin === undefined) return false;
  if (closeMin > openMin) {
    return now.day === period.day && now.minutes >= openMin && now.minutes < closeMin;
  }
  const nextDay = DAY_ORDER[(DAY_ORDER.indexOf(period.day) + 1) % 7];
  return (
    (now.day === period.day && now.minutes >= openMin) ||
    (now.day === nextDay && now.minutes < closeMin)
  );
}

// Returns undefined when `opening_hours` is present but unusable (bad
// timezone, no periods and not always-open) — the caller degrades to the
// static-flag fallback rather than asserting a false status.
function computeOpeningHoursStatus(oh: OpeningHours): boolean | undefined {
  if (oh.always_open) return true;
  if (!oh.timezone || !oh.periods?.length) return undefined;
  const now = venueNow(oh.timezone);
  if (!now) return undefined;
  return oh.periods.some((period) => periodCoversNow(period, now));
}

// The one scalar field design-spec.md places in the rating/meta row instead
// of the fact strip (Restaurants' open_status, Nightlife's live
// open_tonight boolean) — "closed" is muted, never --error (not an error).
// A structured `opening_hours` object, when present and
// usable, supersedes both static flags below with a real computed status —
// always the present-tense "Open"/"Closed" label (never "...tonight").
export function openStatus(
  activity: Activity,
): { text: string; isOpen: boolean } | undefined {
  const d = activity.details;
  if (!d) return undefined;
  const oh = openingHoursOf(d);
  if (oh) {
    const isOpen = computeOpeningHoursStatus(oh);
    if (isOpen !== undefined) {
      return { text: isOpen ? 'Open' : 'Closed', isOpen };
    }
  }
  if (d.category === 'restaurants' && d.open_status) {
    return {
      text: d.open_status,
      isOpen: d.open_status.toLowerCase() !== 'closed',
    };
  }
  if (d.category === 'nightlife' && d.open_tonight !== undefined) {
    return {
      text: d.open_tonight ? 'Open tonight' : 'Closed tonight',
      isOpen: d.open_tonight,
    };
  }
  return undefined;
}

// The mockup's Nightlife screen renders the `Open tonight`
// meta chip *and* the HoursRow underneath at once (`Open 23:00 – 06:00`) —
// two different questions, not one superseded by the other. `openStatus`
// above deliberately can't answer both: its hours-first branch order is
// correct for HoursRow's own present-tense label (tested — hours supersede
// the "tonight" wording there), which is exactly wrong for this chip, and
// its `!todayRow` single-home suppression (ActivityDetailScreen) hides the
// chip whenever hours are usable. This reads `open_tonight` directly,
// independent of hours usability, so the caller can render it unconditionally
// alongside HoursRow instead of choosing one or the other.
export function nightlifeTonightChip(
  activity: Activity,
): { text: string; isOpen: boolean } | undefined {
  const d = activity.details;
  if (!d || d.category !== 'nightlife' || d.open_tonight === undefined) return undefined;
  return { text: d.open_tonight ? 'Open tonight' : 'Closed tonight', isOpen: d.open_tonight };
}

// Monday-first display order for the week view.
// `DAY_ORDER` above stays Sunday-first — that's what `venueNow`/
// `periodCoversNow` key off internally — this is purely a display order.
const WEEK_VIEW_ORDER: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export type WeekViewDay = { day: DayOfWeek; hours: string };

function dayHours(oh: OpeningHours, day: DayOfWeek): string {
  if (oh.always_open) return 'Open 24 hours';
  const dayPeriods = (oh.periods ?? [])
    .filter((p) => p.day === day)
    .slice()
    .sort((a, b) => (hhmmToMinutes(a.open) ?? 0) - (hhmmToMinutes(b.open) ?? 0));
  if (dayPeriods.length === 0) return 'Closed';
  return dayPeriods.map((p) => `${p.open}–${p.close}`).join(', ');
}

// Pure: flat `periods` -> one entry per day, Monday->Sunday. A period is
// bucketed by its own `day` field (the day it *starts*), so a past-midnight
// period like Sunday 20:00-02:00 lands on Sunday, never Monday — matches
// `periodCoversNow`'s own treatment of `period.day` as the start day. A day
// with multiple periods (split hours) lists them ascending by start time,
// comma-joined; a day with none reads "Closed"; `always_open` reads
// "Open 24 hours" for every day. Feeds the Today row and the full-week
// modal — no visual surface of its own.
export function weekView(oh: OpeningHours): WeekViewDay[] {
  return WEEK_VIEW_ORDER.map((day) => ({ day, hours: dayHours(oh, day) }));
}

export function capitalize(day: DayOfWeek): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

export type TodayHoursRowData = {
  status: NonNullable<ReturnType<typeof openStatus>>;
  weekday: string;
  hours: string;
};

// The detail screen's default-state "today" line. Renders only when
// `opening_hours` is present *and* usable — mirrors `openStatus`'s own
// usability gate (`computeOpeningHoursStatus`) plus a resolvable `venueNow`
// for "today"'s venue-local weekday — so a bad/missing timezone degrades to
// `undefined` and the caller falls back to the legacy free-text `hours`
// chip instead of showing a wrong or blank row.
export function todayHoursRow(activity: Activity): TodayHoursRowData | undefined {
  const d = activity.details;
  if (!d) return undefined;
  const oh = openingHoursOf(d);
  if (!oh || computeOpeningHoursStatus(oh) === undefined) return undefined;
  const now = venueNow(oh.timezone);
  if (!now) return undefined;
  const status = openStatus(activity);
  if (!status) return undefined;
  const today = weekView(oh).find((row) => row.day === now.day);
  if (!today) return undefined;
  return {
    status,
    weekday: capitalize(now.day),
    hours: today.hours === 'Closed' ? 'Closed today' : today.hours,
  };
}

export type WeekHoursModalData = { days: WeekViewDay[]; today: DayOfWeek };

// The full-week modal's data — same usability gate as
// `todayHoursRow` above (usable `computeOpeningHoursStatus` + resolvable
// `venueNow`), so the tap affordance and the modal it opens are defined
// exactly when the Today row itself is. `today` is the venue-local weekday
// (for the modal's current-day highlight), `days` is the Monday-first
// `weekView` — no reimplementation of its closed/split/always-open rendering.
export function weekHoursModalData(activity: Activity): WeekHoursModalData | undefined {
  const d = activity.details;
  if (!d) return undefined;
  const oh = openingHoursOf(d);
  if (!oh || computeOpeningHoursStatus(oh) === undefined) return undefined;
  const now = venueNow(oh.timezone);
  if (!now) return undefined;
  return { days: weekView(oh), today: now.day };
}
