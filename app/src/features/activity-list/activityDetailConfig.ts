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
import { classifyField } from './fieldKind';
import { CATEGORY_LABELS, SUBCATEGORIES } from './filters';

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
// design-spec.md's "List rows" slot (§B6): new `duration` density — name +
// duration + `from €X` (Treatments). `name` is typed optional (not required
// like `nameprice`'s items) because the slot-level rule is distinct from the
// ordinary trailing-omits-per-row rule: a row whose *name* is absent is
// dropped entirely, so the renderer (not just the caller) must defend
// against it — see UniqueSection.tsx.
export type DurationRow = { name?: string; duration?: string; price?: string };

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
    }
  | {
      shape: 'schedule';
      heading: string;
      density: 'duration';
      rows: DurationRow[];
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

// design-spec.md's "Screen composition" section (T5): one fixed canonical
// order replaces the 13 hand-maintained per-category arrays this retires
// (`BODY_SECTION_ORDER`, deleted). Hero/title-block/action-chips/hours-row
// live directly in ActivityDetailScreen.tsx (not category-dependent);
// 'factstrip' below is the stat grid. Sections whose data is absent are
// still skipped by the renderer — this only fixes order.
export type BodySection = 'description' | 'difficulty' | 'factstrip' | 'unique' | 'goodtoknow';

const CANONICAL_BODY_ORDER: BodySection[] = ['factstrip', 'description', 'unique', 'goodtoknow'];

// "A category may promote exactly one slot above the stat grid. That is the
// entire per-category layout freedom [...]" — 'difficulty' (Sport's
// DifficultyMeter) has no canonical resting position of its own, since it
// only ever appears promoted. T5 carries over each category's *current*
// promoted section unchanged, proving the mechanism without deciding any
// category's final composition (T6-T10's job) — cafes/nightlife/sport/
// culture/art/shopping already promoted the same section under the old
// per-category arrays, so the *promoted* slot itself matches exactly.
//
// The rest of each row is NOT guaranteed byte-identical, though, because
// this table (unlike the old 13 arrays) has no way to structurally exclude
// a slot — every category now renders every canonical slot its data fills.
// That's a correct, data-driven consequence of the new model, not a bug,
// but it does change what's on screen for three categories whose old array
// had left a slot out on purpose: Nightlife and Sport's old arrays never
// listed 'description' at all (both are Places-live, so Google's prose can
// arrive and now does), and Shopping's old array had 'unique' before
// 'factstrip' (now 'factstrip' comes first, per the fixed canonical order).
// See engineering-notes.md's T5 entry for the full disclosure.
// Not exported — `bodySectionOrder` below is the only thing any other
// module needs; T6-T10 edit this table in place.
type PromotableSection = 'description' | 'difficulty' | 'unique';

const PROMOTE_ABOVE_STAT_GRID: Partial<Record<Category, PromotableSection>> = {
  cafes: 'description',
  nightlife: 'unique',
  sport: 'difficulty',
  culture: 'unique',
  art: 'unique',
  shopping: 'description',
};

export function bodySectionOrder(category: Category): BodySection[] {
  const promoted = PROMOTE_ABOVE_STAT_GRID[category];
  if (!promoted) return CANONICAL_BODY_ORDER;
  return [promoted, ...CANONICAL_BODY_ORDER.filter((section) => section !== promoted)];
}

// design-spec.md T8 addendum #8 + spec's Entertainment composition
// (`Entertainment · Cinema · Neighborhood · 700 m`): Entertainment's
// neighborhood moves into the rating/meta row (muted, "·"-separated)
// instead of the removed fact strip. No other category uses this —
// everything else keeps its scalar meta-row item (openStatus) or omits.
// `genre` deliberately excluded here (T5 round-2 fix): once T5 also
// prepends category-noun + subtype into the same row (`metaLineLeadItems`),
// category + subtype + distance + genre + neighborhood overflows
// `MetaLine`'s `MAX_ITEMS = 4` and silently truncates neighborhood — a
// production regression T5's own "carry over current values unchanged"
// scope must not introduce. `genre` isn't in the spec's canonical
// Entertainment meta line at all, so dropping it both fixes the overflow
// and matches the final composition T9 will land.
export function metaRowExtras(activity: Activity): string[] {
  const d = activity.details;
  if (!d || d.category !== 'entertainment') return [];
  return [d.neighborhood].filter((v): v is string => Boolean(v));
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

// design-spec.md's "Bottom bar" slot (§B12): optional price-context line
// (`From €12`) above the button row, omitting only that line when absent —
// `price_from` is `scalar` per "Kind declarations on existing fields", so it
// goes through the same classifyField guard as any other generated field.
// Wellness does NOT get this line (T9: "external-booking note + Visit
// website", `price_from` surfaces only in the stat grid) — showing it there
// would double the same figure on the exact production-bug screen. Wired for
// Entertainment (`price_from`) today; T7/T10 add Nightlife's `entry_price`
// and Tours' starting-price field as their screens land — this task only
// builds the slot mechanics.
export function priceContextLine(activity: Activity): string | undefined {
  const d = activity.details;
  if (!d || d.category !== 'entertainment') return undefined;
  const price = classifyField('scalar', d.price_from);
  return price ? `From ${price}` : undefined;
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

// design-spec.md's "Two rules applied to all 13" (T5): subtype comes from
// the activity's own `subcategory` slug — already taxonomy-validated
// (BUSINESS_STANDARDS.md), translatable, always scalar by construction —
// never from a generated field. Retires `badgeQualifier`'s 9-branch switch
// over per-category generated fields (cuisine/venue_type/discipline/etc.).
// `""`/absent (documented as common for the three Tripadvisor categories,
// whose subtype is only set when the per-venue Google name lookup
// succeeds) reads as "no subtype" — no fallback is invented, and the
// retired generated qualifier is not resurrected as a stand-in.
export function subtypeLabel(activity: Activity): string | undefined {
  if (!activity.subcategory) return undefined;
  // `activity.category` comes off an unvalidated wire cast (api/activities.ts)
  // — a category the app doesn't yet recognize has no `SUBCATEGORIES` entry,
  // so this degrades to "no subtype" instead of crashing (the retired
  // `badgeQualifier` switch had a `default:` doing the same job).
  return SUBCATEGORIES[activity.category]?.find((option) => option.value === activity.subcategory)
    ?.label;
}

// design-spec.md's "Meta line" slot composition (§B1): "category noun,
// subtype, price level, distance" — category noun leads, subtype follows
// when present. Both are app-computed/taxonomy data, not LLM-generated, so
// — like distance/country — they bypass `classifyField` entirely (see
// MetaLine's `rawItems`) rather than being subject to the scalar kind's
// length/word-count checks meant for generated content. Price level
// (Tripadvisor-only today, via `tripadvisorEyebrow`) and any other
// category-specific meta-line content is T6-T10's composition work, not
// this mechanism.
export function metaLineLeadItems(activity: Activity): (string | undefined)[] {
  return [categoryNoun(activity.category), subtypeLabel(activity)];
}

// opening-hours T3: the seven in-scope categories may carry a structured
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
// render based on array length.
export function factStripFields(activity: Activity): FactChip[] {
  const d = activity.details;
  if (!d) return [];
  // T4 (activity-detail-system): structured `opening_hours`, when usable,
  // now renders as its own standalone HoursRow (design-spec.md's "Hours
  // row" slot leaves the stat grid entirely) — see ActivityDetailScreen's
  // `<HoursRow>`. This helper only ever appends the legacy free-text
  // fallback chip, and only when there's no usable structured data to
  // supersede it (same mutual-exclusivity as before). Omits the chip
  // (returns `chips` unchanged) when there's nothing to show.
  function withHours(chips: FactChip[], legacyHours: string | undefined): FactChip[] {
    if (todayHoursRow(activity)) return chips;
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
