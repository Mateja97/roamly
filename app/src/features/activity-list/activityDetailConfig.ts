import type { ComponentType } from 'react';
import {
  BarChart3,
  Calendar,
  Clock,
  Coffee,
  Euro,
  Image as ImageIcon,
  Landmark,
  Martini,
  Shirt,
  Store,
  Sun,
  Utensils,
  Wifi,
  Wrench,
} from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import type {
  Activity,
  ActivityDetails,
  DayOfWeek,
  OpeningHours,
  OpeningHoursPeriod,
  TripadvisorAttribution,
  TripadvisorReview,
} from '../../api/activities';
import type { Category } from './types';
import { CATEGORY_LABELS } from './filters';

// design-spec.md's T4 "Config table" section: one lookup, built from
// APP_STANDARDS.md's per-category table, driving the fact strip + unique
// section + CTA labels. Implemented as per-category functions (not a plain
// object of closures) because `ActivityDetails` is a discriminated union —
// TS only narrows `activity.details` to a category's field shape inside a
// `switch`/`if` on `.category`, so the switch below *is* the lookup table.

export type FactChip = {
  icon: ComponentType<LucideProps>;
  label: string;
  value: string;
  // opening-hours T3: present only on the Hours chip when structured
  // opening_hours is usable — marks it interactive so FactStrip renders it
  // as a Pressable (opens the T2 week modal) instead of a plain View.
  onPress?: () => void;
};

export type CompactRow = {
  leading: string;
  main: string;
  trailing?: string;
  trailingStyle?: 'muted' | 'price';
};
export type DateBlockRow = {
  day: string;
  date: string;
  title: string;
  subline: string;
};

export type UniqueSectionData =
  | {
      shape: 'nameprice';
      heading: string;
      items: { name: string; price: string }[];
    }
  | { shape: 'pills'; heading: string; items: string[] }
  | { shape: 'checklist'; heading: string; items: string[] }
  | { shape: 'icongrid'; heading: string; items: string[] }
  | {
      shape: 'banner';
      heading: string;
      title: string;
      description?: string;
    }
  | {
      shape: 'schedule';
      heading: string;
      density: 'compact';
      rows: CompactRow[];
    }
  | {
      shape: 'schedule';
      heading: string;
      density: 'dateblock';
      rows: DateBlockRow[];
    };

// Categories whose primary CTA *is* "Get directions" — the generic action
// swaps to Share for these so the two action-bar buttons never both say
// directions (design-spec.md's shared base layout rule).
const DIRECTIONS_PRIMARY: Category[] = ['cafes', 'nature', 'kids', 'shopping'];

export const PRIMARY_CTA_LABEL: Record<Category, string> = {
  restaurants: 'Book a table',
  bars: 'See menu',
  cafes: 'Get directions',
  nightlife: 'Guest list',
  nature: 'Get directions',
  sport: 'Book session',
  kids: 'Get directions',
  culture: 'Get tickets',
  art: 'Get tickets',
  wellness: 'Visit website',
  entertainment: 'Get tickets',
  shopping: 'Get directions',
  // T3 (roa-5-category-subtypes): new category, no bespoke detail UI in
  // scope (see product-tasks.md's T3 out-of-scope) — generic label, same
  // treatment as any other non-directions category.
  tours_experiences: 'Book now',
};

export function primaryCTAIsDirections(category: Category): boolean {
  return DIRECTIONS_PRIMARY.includes(category);
}

export function genericActionLabel(category: Category): 'Directions' | 'Share' {
  return primaryCTAIsDirections(category) ? 'Share' : 'Directions';
}

// design-spec.md T8 addendum #1: the 8 non-directions categories' primary
// CTA opens this external `action_url` (T7). `undefined` only when the
// field is genuinely absent — never force-disabled by category alone.
export function primaryActionURL(activity: Activity): string | undefined {
  const d = activity.details;
  if (!d) return undefined;
  switch (d.category) {
    case 'restaurants':
    case 'bars':
    case 'nightlife':
    case 'sport':
    case 'culture':
    case 'art':
    case 'wellness':
    case 'entertainment':
      return d.action_url;
    default:
      return undefined;
  }
}

// design-spec.md T8 addendum #3: per-category body-section top→bottom
// order, replacing the previous single hardcoded order. Sections whose data
// is absent are simply skipped by the renderer — this table only fixes
// order, not the existing per-section omission rules.
export type BodySection = 'description' | 'difficulty' | 'factstrip' | 'unique' | 'goodtoknow';

export const BODY_SECTION_ORDER: Record<Category, BodySection[]> = {
  restaurants: ['factstrip', 'description', 'unique'],
  bars: ['factstrip', 'description', 'unique'],
  cafes: ['description', 'factstrip', 'unique'],
  nightlife: ['unique', 'factstrip'],
  nature: ['factstrip', 'description', 'unique'],
  sport: ['difficulty', 'factstrip', 'unique'],
  kids: ['description', 'unique'],
  culture: ['unique', 'factstrip', 'description'],
  art: ['unique', 'factstrip', 'description'],
  wellness: ['factstrip', 'description', 'unique', 'goodtoknow'],
  entertainment: ['factstrip', 'description', 'unique', 'goodtoknow'],
  shopping: ['description', 'unique', 'factstrip'],
  // T3 (roa-5-category-subtypes): no bespoke detail UI in scope — `details`
  // has no `tours_experiences` variant (ActivityDetails), so factstrip/unique
  // simply omit themselves (no data); this is the same generic order as
  // kids/wellness above.
  tours_experiences: ['description', 'unique'],
};

// design-spec.md T8 addendum #8: Entertainment's genre + neighborhood move
// into the rating/meta row (muted, "·"-separated) instead of the removed
// fact strip. No other category uses this — everything else keeps its
// scalar meta-row item (openStatus) or omits.
export function metaRowExtras(activity: Activity): string[] {
  const d = activity.details;
  if (!d || d.category !== 'entertainment') return [];
  return [d.genre, d.neighborhood].filter((v): v is string => Boolean(v));
}

// design-spec.md T8 addendum #5: Art's artist/work/medium/year attribution
// line, lifted out of the unique-section banner into the title block.
// `workYear` is rendered in italic by the caller; `undefined` fields are
// simply left out of the joined line by the caller.
export type ArtAttribution = { artist?: string; workYear?: string; medium?: string };

export function artAttribution(activity: Activity): ArtAttribution | undefined {
  const d = activity.details;
  if (!d || d.category !== 'art' || !d.artwork) return undefined;
  const { artist, work, medium } = d.artwork;
  if (!artist && !work && !medium) return undefined;
  const workYear = work ? (d.year ? `${work}, ${d.year}` : work) : undefined;
  return { artist, workYear, medium };
}

// design-spec.md T8 (Tripadvisor initiative): a row is Tripadvisor-treated
// iff `details.tripadvisor` is present — the sole detection signal (no
// `Source` field on the wire, not needed for UI detection). Restaurants/bars
// are Tripadvisor-exclusive; cafés joined as a third, dual-sourced category
// per fix(activities-service) #104 ("restore Google as a Café source
// alongside Tripadvisor" — a café can genuinely come from either provider).
// Shared by ActivityCard and the detail screen so the union-narrowing switch
// lives in exactly one place.
export function tripadvisorAttribution(activity: Activity): TripadvisorAttribution | undefined {
  const d = activity.details;
  if (!d) return undefined;
  switch (d.category) {
    case 'restaurants':
    case 'bars':
    case 'cafes':
      return d.tripadvisor;
    default:
      return undefined;
  }
}

// Backend-gated per compliance rule 04 — only ever populated alongside a
// Tripadvisor-treated row. Always an array (never undefined) so callers
// (the reviews carousel) self-guard on `.length` the same way FactStrip
// self-guards on an empty fields array — up to 3 per T3.
export function tripadvisorReviews(activity: Activity): TripadvisorReview[] {
  const d = activity.details;
  if (!d) return [];
  switch (d.category) {
    case 'restaurants':
    case 'bars':
    case 'cafes':
      return d.reviews ?? [];
    default:
      return [];
  }
}

// design-spec.md T4's Place-facts list: "Address — static text (Address/City
// already flowing)". Joins the two already-on-the-wire fields into one line;
// undefined (row omitted) when both are blank rather than showing a lone
// comma.
export function tripadvisorAddressLine(activity: Activity): string | undefined {
  const parts = [activity.address, activity.city].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

// design-spec.md T8 addendum #6: Wellness' external-booking note, lifted
// out of the Treatments rows into the bottom action bar (above the button
// row) — always present for Wellness once this data exists.
export function wellnessBookingNote(activity: Activity): string | undefined {
  const d = activity.details;
  return d?.category === 'wellness' ? d.external_booking_note : undefined;
}

// design-spec.md T8 addendum #2: the noun before the "·" is the *singular*
// category word, not the plural CATEGORY_LABELS value — only these three
// differ from their plural label (Kids stays "Kids", every other category's
// label word is already singular).
const SINGULAR_NOUN: Partial<Record<Category, string>> = {
  restaurants: 'Restaurant',
  cafes: 'Café',
  bars: 'Bar',
};

function categoryNoun(category: Category): string {
  return SINGULAR_NOUN[category] ?? CATEGORY_LABELS[category];
}

// §5b: the eyebrow line above a Tripadvisor row's title — category · price
// level · distance. `price_level` is Terra's own exact string ("Cheap
// Eats"/"Mid Range"/"Fine Dining"), rendered verbatim, never reformatted to
// $ symbols; omitted from the line (not blanked) when Tripadvisor didn't
// return one. `undefined` for a non-Tripadvisor row (no eyebrow at all).
export function tripadvisorEyebrow(activity: Activity, distanceText: string): string | undefined {
  const tripadvisor = tripadvisorAttribution(activity);
  if (!tripadvisor) return undefined;
  return [categoryNoun(activity.category), tripadvisor.price_level, distanceText]
    .filter((v): v is string => Boolean(v))
    .join(' · ');
}

// Per-category subtype qualifier, pulled from an existing `details` field —
// omitted (no dangling "·") when that field is absent, per the
// omit-rather-than-blank rule.
export function badgeQualifier(activity: Activity): string | undefined {
  const d = activity.details;
  if (!d) return undefined;
  switch (d.category) {
    case 'restaurants':
      return d.cuisine;
    case 'cafes':
      return d.known_for_brew;
    case 'nightlife':
      return d.venue_type;
    case 'sport':
      return d.discipline;
    case 'kids':
      return d.age_range ? `Ages ${d.age_range}` : undefined;
    case 'culture':
    case 'art':
    case 'shopping':
      return d.venue_type;
    case 'wellness':
      return d.venue_type;
    case 'entertainment':
      return d.genre;
    default:
      return undefined;
  }
}

export function badgeLabel(activity: Activity): string {
  const qualifier = badgeQualifier(activity);
  const noun = categoryNoun(activity.category);
  return qualifier ? `${noun} · ${qualifier}` : noun;
}

// opening-hours T3: the seven in-scope categories may carry a structured
// `opening_hours` object — this is the one place that reads it off the
// discriminated `ActivityDetails` union (mirrors `badgeQualifier`'s switch).
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
// opening-hours T3: a structured `opening_hours` object, when present and
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

// opening-hours T1: Monday-first display order for the week view.
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
// "Open 24 hours" for every day. Feeds this task's Today row and T2's
// full-week modal — no visual surface of its own.
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

// opening-hours T1: the detail screen's default-state "today" line. Renders
// only when `opening_hours` is present *and* usable — mirrors `openStatus`'s
// own usability gate (`computeOpeningHoursStatus`) plus a resolvable
// `venueNow` for "today"'s venue-local weekday — so a bad/missing timezone
// degrades to `undefined` and the caller falls back to the legacy free-text
// `hours` chip instead of showing a wrong or blank row.
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

// opening-hours T2: the full-week modal's data — same usability gate as
// `todayHoursRow` above (usable `computeOpeningHoursStatus` + resolvable
// `venueNow`), so the tap affordance and the modal it opens are defined
// exactly when the Today row itself is. `today` is the venue-local weekday
// (for the modal's current-day highlight), `days` is T1's own Monday-first
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

function buildChips(
  entries: [ComponentType<LucideProps>, string, string | undefined][],
): FactChip[] {
  return entries
    .filter((entry): entry is [ComponentType<LucideProps>, string, string] =>
      Boolean(entry[2]),
    )
    .map(([icon, label, value]) => ({ icon, label, value }));
}

// Per-field omission lives here: `buildChips` drops any field with no value,
// so the fact strip naturally re-flows to 2 chips or omits itself entirely
// (empty array) with no placeholder — the component decides whether to
// render based on array length. The Hours chip is appended separately (via
// `withHours` below) since its shape isn't a plain [icon, label, value]
// triple once it's interactive.
export function factStripFields(
  activity: Activity,
  onPressHours?: () => void,
): FactChip[] {
  const d = activity.details;
  if (!d) return [];
  // opening-hours T3: the one Hours chip builder shared by every category
  // below. Structured `opening_hours` usable -> today's status is the bold
  // value line, today's hour range is the muted label line (mirrors the
  // sibling chip's value/label shape), and `onPressHours` makes it a real
  // tap target reopening the T2 week modal. Otherwise falls back to the
  // legacy free-text value under the static "Hours" label, non-interactive
  // — exactly the chip that shipped before T1 (no chevron, no tap target).
  // Omits the chip (returns `chips` unchanged) when there's nothing to show.
  function withHours(chips: FactChip[], legacyHours: string | undefined): FactChip[] {
    const today = todayHoursRow(activity);
    if (today) {
      return [
        ...chips,
        { icon: Clock, value: today.status.text, label: today.hours, onPress: onPressHours },
      ];
    }
    return legacyHours ? [...chips, { icon: Clock, value: legacyHours, label: 'Hours' }] : chips;
  }
  switch (d.category) {
    case 'restaurants':
      // §5b: a Tripadvisor-sourced row now carries its own cuisine (eyebrow
      // subtitle) and price level (eyebrow line) via `tripadvisorEyebrow`
      // above — the generic Cuisine/Price chips would just repeat that, so
      // they're dropped for Tripadvisor rows only; every other restaurant
      // row keeps them exactly as before.
      return withHours(
        d.tripadvisor
          ? []
          : buildChips([
              [Utensils, 'Cuisine', d.cuisine],
              [Euro, 'Price', d.price_tier],
            ]),
        d.hours,
      );
    case 'bars':
      return buildChips([
        [Martini, 'Vibe', d.vibe],
        [Clock, 'Happy hour', d.happy_hour_window],
        [Clock, 'Opens', d.opens_time],
      ]);
    case 'cafes':
      return withHours(
        buildChips([
          [Coffee, 'Known for', d.known_for_brew],
          [Wifi, 'Wifi', d.wifi_quality],
        ]),
        d.hours,
      );
    case 'nightlife':
      return buildChips([
        [Euro, 'Entry', d.entry_price],
        [Shirt, 'Dress code', d.dress_code],
        [Clock, 'Opens', d.opens_time],
      ]);
    case 'nature':
      return buildChips([
        [Clock, 'Time to spend', d.time_to_spend],
        [Sun, 'Best time', d.best_time],
        [Euro, 'Cost', d.cost],
      ]);
    case 'sport':
      return buildChips([
        [BarChart3, 'Effort', d.effort_level],
        [Clock, 'Duration', d.duration],
        [Wrench, 'Gear', d.gear],
      ]);
    case 'culture':
      return withHours(
        buildChips([
          [Landmark, 'Venue', d.venue_type],
          [Euro, 'Tickets', d.ticket_price],
        ]),
        d.hours,
      );
    case 'art':
      return withHours(
        buildChips([
          [ImageIcon, 'Venue', d.venue_type],
          [Euro, 'Tickets', d.ticket_price],
        ]),
        d.hours,
      );
    case 'shopping':
      return withHours(
        buildChips([
          [Store, 'Venue', d.venue_type],
          [Calendar, 'Best day', d.best_day],
        ]),
        d.hours,
      );
    case 'kids':
      return [];
    case 'wellness':
      return withHours(
        buildChips([
          [Clock, 'Typical visit', d.typical_visit],
          [Euro, 'Price from', d.price_from],
        ]),
        undefined,
      );
    case 'entertainment':
      return withHours(
        buildChips([
          [Clock, 'Typical show', d.typical_show_length],
          [Euro, 'Price from', d.price_from],
        ]),
        undefined,
      );
    default:
      // ponytail: proxy sends `details: {}` (no omitempty) for every
      // activity with no category-specific data — `.category` is missing,
      // not one of the known values. Degrade to "no fact strip" instead of
      // crashing FactStrip on `fields.length` of undefined.
      return [];
  }
}

// Backend's `upcoming_shows[].date` has no fixed documented format; parse it
// as a real date for the day/numeral split when possible, and fall back to
// showing the raw string as the numeral (no day label) when it isn't a
// parseable date — never throws on unexpected input.
function dateBlockRow(show: {
  date: string;
  title: string;
  time_or_price?: string;
}): DateBlockRow {
  const parsed = new Date(show.date);
  const valid = !Number.isNaN(parsed.getTime());
  let day = '';
  let date = show.date;
  if (valid) {
    try {
      day = parsed
        .toLocaleDateString(undefined, { weekday: 'short' })
        .toUpperCase();
      date = String(parsed.getDate());
    } catch {
      // ponytail: Intl unavailable — falls back to the raw date string above.
    }
  }
  return { day, date, title: show.title, subline: show.time_or_price ?? '' };
}

// Whole-section omission lives here too: every branch returns `undefined`
// when its category's list/banner data is absent.
export function uniqueSection(
  activity: Activity,
): UniqueSectionData | undefined {
  const d = activity.details;
  if (!d) return undefined;
  switch (d.category) {
    case 'restaurants':
      return d.popular_dishes?.length
        ? {
            shape: 'nameprice',
            heading: 'Popular dishes',
            items: d.popular_dishes,
          }
        : undefined;
    case 'cafes':
      return d.on_the_bar?.length
        ? { shape: 'nameprice', heading: 'On the bar', items: d.on_the_bar }
        : undefined;
    case 'bars':
      return d.signature_pours?.length
        ? {
            shape: 'pills',
            heading: 'Signature pours',
            items: d.signature_pours,
          }
        : undefined;
    case 'shopping':
      return d.what_youll_find?.length
        ? {
            shape: 'pills',
            heading: "What you'll find",
            items: d.what_youll_find,
          }
        : undefined;
    case 'nature':
      return d.good_to_know?.length
        ? { shape: 'checklist', heading: 'Good to know', items: d.good_to_know }
        : undefined;
    case 'sport':
      return d.what_to_bring?.length
        ? {
            shape: 'checklist',
            heading: 'What to bring',
            items: d.what_to_bring,
          }
        : undefined;
    case 'kids':
      return d.facilities?.length
        ? { shape: 'icongrid', heading: 'Facilities', items: d.facilities }
        : undefined;
    case 'culture':
      return d.now_showing
        ? {
            shape: 'banner',
            heading: 'Now showing',
            title: d.now_showing.title,
            description: d.now_showing.description,
          }
        : undefined;
    case 'art':
      return d.current_exhibition
        ? {
            shape: 'banner',
            heading: 'Current exhibition',
            title: d.current_exhibition.title,
            description: d.current_exhibition.description,
          }
        : undefined;
    case 'nightlife':
      return d.lineup?.length
        ? {
            shape: 'schedule',
            heading: 'Tonight',
            density: 'compact',
            rows: d.lineup.map((l) => ({
              leading: l.time,
              main: l.act,
              trailing: l.stage,
              trailingStyle: 'muted' as const,
            })),
          }
        : undefined;
    case 'wellness':
      return d.treatments?.length
        ? {
            shape: 'schedule',
            heading: 'Treatments',
            density: 'compact',
            rows: d.treatments.map((t) => ({
              leading: t.duration ?? '',
              main: t.item,
              trailing: t.price,
              trailingStyle: 'price' as const,
            })),
          }
        : undefined;
    case 'entertainment':
      return d.upcoming_shows?.length
        ? {
            shape: 'schedule',
            heading: 'Upcoming shows',
            density: 'dateblock',
            rows: d.upcoming_shows.map(dateBlockRow),
          }
        : undefined;
    default:
      // ponytail: same `details: {}` shape as factStripFields above.
      return undefined;
  }
}

// Second body section alongside uniqueSection() — the design's Wellness/
// Entertainment frames (6i/6j) each carry a list section (Treatments /
// Upcoming shows) *and* a separate "Good to know" checklist, which
// UniqueSectionData's single-value shape can't hold at once. Reuses the
// existing 'checklist' shape (same one Nature/Sport already render via
// uniqueSection) as a second, independent instance.
export function goodToKnowSection(activity: Activity): UniqueSectionData | undefined {
  const d = activity.details;
  if (!d) return undefined;
  const items = d.category === 'wellness' || d.category === 'entertainment' ? d.good_to_know : undefined;
  return items?.length ? { shape: 'checklist', heading: 'Good to know', items } : undefined;
}
