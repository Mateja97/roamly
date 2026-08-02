import type { ComponentType } from 'react';
import {
  BarChart3,
  Calendar,
  Clock,
  Coffee,
  Euro,
  Landmark,
  Languages as LanguagesIcon,
  Martini,
  Shirt,
  Store,
  Sun,
  Users,
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
  // design-spec.md's Stat grid degradation rule folds a single surviving
  // chip's *value* alone into the meta line, dropping `.label` — deliberate
  // (T4), and most chips read fine bare there ("Fast" for Wifi). A
  // price-shaped chip's raw value doesn't: T9 round-3 found a real venue
  // whose folded Wellness "Price from" value rendered as a bare, unlabeled
  // "500" with no currency/unit. This optional prefix is applied only at
  // fold time (see ActivityDetailScreen.tsx) — never in the grid, where the
  // chip's own label already carries the context.
  foldPrefix?: string;
};

export type CompactRow = {
  leading: string;
  main: string;
  trailing?: string;
  trailingStyle?: 'muted' | 'price';
  // Mockup's Itinerary rows render `leading` as a 22px gold-bordered numbered
  // circle instead of the plain wide text column sized for a time (e.g.
  // Nightlife's `21:00`) — every other `compact` consumer omits this and
  // keeps the existing text treatment.
  leadingStyle?: 'number';
};
export type DateBlockRow = {
  day: string;
  date: string;
  // T11: a raw `date` that's scalar-valid (passes classifyField, so it's
  // not denylisted/over-length) but doesn't parse into the structured
  // day+numeral split — set instead of `date`/`day`, rendered as an
  // unstructured muted label in the row body rather than crushed into the
  // 44px-wide numeral column sized for a 1-2 digit day (design.dc.html's
  // date-block geometry — ~99 of 761 live `upcoming_shows[].date` values
  // hit exactly this case: e.g. "TBA", "Q4 2026").
  dateLabel?: string;
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
  | {
      shape: 'checklist';
      heading: string;
      items: string[];
      // design-import mockup's slot #8 "extended" note: the ✗ variant, added
      // for Tours & Experiences' what's-not-included list — every other
      // checklist consumer simply omits this and keeps the plain ✓ list.
      crossItems?: string[];
    }
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
  // design-spec.md's Tours & Experiences composition (T10): "Bottom:
  // `From €18` + `Check availability`" — label is fixed regardless of
  // `details` being present (no `action_url`-equivalent field exists on
  // this category's schema; the CTA is disabled until one does, same as
  // any other category with no `primaryActionURL`).
  tours_experiences: 'Check availability',
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
//
// T8: Kids now has an explicit entry. `factStripFields` returns `[]`
// unconditionally for kids (no stat grid per spec), so this promotion is a
// no-op on the *rendered* order (description already leads with nothing
// above it) — kept explicit anyway so this table states the spec's
// composition truthfully instead of relying on a side effect of another
// function to read as "already correct" (T5/T5-round-2/3's own gap, closed
// here).
// Not exported — `bodySectionOrder` below is the only thing any other
// module needs; T6-T10 edit this table in place.
type PromotableSection = 'description' | 'difficulty' | 'unique';

const PROMOTE_ABOVE_STAT_GRID: Partial<Record<Category, PromotableSection>> = {
  cafes: 'description',
  nightlife: 'unique',
  sport: 'difficulty',
  kids: 'description',
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

// T9 review: T2's own worked example for a scraped price scalar already
// includes a "from " prefix (websitesync.go wellnessPrompt/
// entertainmentPrompt: "from €25"/"from €8"), so a compliant scrape can hand
// us a value that's already prefixed — prepending our own "from "/"From "
// on top would double it. Strip any existing leading "from" (case-
// insensitive) before either call site adds its own prefix.
export function stripLeadingFrom(value: string): string {
  return value.replace(/^from\s+/i, '');
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
// the backing field is `scalar` per "Kind declarations on existing fields",
// so it goes through the same classifyField guard as any other generated
// field. Wellness does NOT get this line (T9: "external-booking note + Visit
// website", `price_from` surfaces only in the stat grid) — showing it there
// would double the same figure on the exact production-bug screen. T7:
// Nightlife's spec bottom bar is `From €10` + `Guest list` — same field
// (`entry_price`) already feeds the Entry stat-grid chip, same doubling
// pattern Entertainment already established for `price_from`. T10 checked:
// `ToursExperiencesDetails` (backend/shared/models/activitiessvc/activity.go)
// has no price field of any kind, so Tours structurally can't populate this
// slot — needs a product decision (new backend field), not an app-side fix;
// see engineering-notes.md T10.
export function priceContextLine(activity: Activity): string | undefined {
  const d = activity.details;
  if (!d) return undefined;
  const raw =
    d.category === 'entertainment'
      ? d.price_from
      : d.category === 'nightlife'
        ? d.entry_price
        : undefined;
  const price = classifyField('scalar', raw);
  return price ? `From ${stripLeadingFrom(price)}` : undefined;
}

// design-spec.md T8 addendum #2: the noun before the "·" is the *singular*
// category word, not the plural CATEGORY_LABELS value — every other
// category's label word is already singular (Kids stays "Kids"). T10:
// Tours & Experiences' meta line reads "Tour · ..." (spec's own composition
// example), not the plural "Tours & Experiences" filter-list label.
const SINGULAR_NOUN: Partial<Record<Category, string>> = {
  restaurants: 'Restaurant',
  cafes: 'Café',
  bars: 'Bar',
  tours_experiences: 'Tour',
};

function categoryNoun(category: Category): string {
  return SINGULAR_NOUN[category] ?? CATEGORY_LABELS[category];
}

// §5b, extended by T6: the eyebrow line above a Tripadvisor row's title —
// this *is* the Meta line slot for a Tripadvisor restaurant/bar/café row
// (§C's exact composition: `Restaurant · Fine Dining · $$$ · 400 m`,
// `Bar · Cocktail Bar · 200 m`, `Café · Coffee Shop · 150 m` — category,
// subtype, then price level, then distance). Subtype is `subtypeLabel`, same
// taxonomy-slug source as every other category (never a generated field).
// `price_level` is Terra's own exact string ("Cheap Eats"/"Mid
// Range"/"Fine Dining"), rendered verbatim, never reformatted to $ symbols
// — and only Restaurants' composition names it ("price level already sits
// in the meta line"); Bars/Cafés' compositions don't, so it's scoped to
// `restaurants` here even though the wire type carries the field for every
// Tripadvisor-sourced category. Every item omits individually (never
// blanked) when its source data is absent. `undefined` for a
// non-Tripadvisor row (no eyebrow at all).
export function tripadvisorEyebrow(activity: Activity, distanceText: string): string | undefined {
  const tripadvisor = tripadvisorAttribution(activity);
  if (!tripadvisor) return undefined;
  const priceLevel = activity.category === 'restaurants' ? tripadvisor.price_level : undefined;
  return [categoryNoun(activity.category), subtypeLabel(activity), priceLevel, distanceText]
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

// design-spec.md T8's Kids composition: `Kids · <subtype> · Ages X–Y ·
// <distance>` — the one meta-line item so far that must land *before*
// distance rather than after it (unlike `metaRowExtras`, which only ever
// appends), so it's classified here (generated content, same
// `classifyField('scalar', …)` guard every other meta-line value gets) and
// handed to the caller as an already-final string for `rawItems`, not
// `items` (see ActivityDetailScreen.tsx's meta-line wiring).
export function kidsAgeLabel(activity: Activity): string | undefined {
  const d = activity.details;
  if (!d || d.category !== 'kids') return undefined;
  const range = classifyField('scalar', d.age_range);
  return range ? `Ages ${range}` : undefined;
}

// design-spec.md T8 addendum #7 (Culture/Shopping's shared "Venue" stat):
// "Venue only when it differs from the subtype" — comparing the *labels*
// (subtype's taxonomy label, not the raw `subcategory` slug) so a venue_type
// that merely repeats the subtype in different casing/whitespace still
// counts as the same value and the tile doesn't just duplicate the meta
// line. Absent subtype (see subtypeLabel's own absence rule) always counts
// as "differs" — nothing to compare against, so the raw value is shown.
export function venueDiffersFromSubtype(activity: Activity, venueType: string | undefined): string | undefined {
  if (!venueType) return undefined;
  const subtype = subtypeLabel(activity);
  if (subtype && subtype.trim().toLowerCase() === venueType.trim().toLowerCase()) return undefined;
  return venueType;
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

// T7 round-2 fix: the mockup's Nightlife screen renders the `Open tonight`
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
  entries: [ComponentType<LucideProps>, string, string | undefined, string?][],
): FactChip[] {
  return entries
    .filter(
      (entry): entry is [ComponentType<LucideProps>, string, string, string?] =>
        Boolean(entry[2]),
    )
    .map(([icon, label, value, foldPrefix]) => ({
      icon,
      label,
      value,
      ...(foldPrefix ? { foldPrefix } : {}),
    }));
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
      // design-spec.md's Culture composition: `Tickets`, plus `Venue` only
      // when it differs from the subtype (see `venueDiffersFromSubtype`).
      return withHours(
        buildChips([
          [Euro, 'Tickets', d.ticket_price],
          [Landmark, 'Venue', venueDiffersFromSubtype(activity, d.venue_type)],
        ]),
        d.hours,
      );
    case 'art':
      // design-spec.md's Art composition: `Tickets` only — unlike Culture/
      // Shopping, Art has no Venue stat at all (the artist/work attribution
      // line above the title already carries that context).
      return withHours(buildChips([[Euro, 'Tickets', d.ticket_price]]), d.hours);
    case 'shopping':
      // T9: "Best day, plus Venue when it differs from the subtype" — reuses
      // T8's `venueDiffersFromSubtype` (same conditional Culture's stat grid
      // above uses), not a re-derivation of it.
      return withHours(
        buildChips([
          [Calendar, 'Best day', d.best_day],
          [Store, 'Venue', venueDiffersFromSubtype(activity, d.venue_type)],
        ]),
        d.hours,
      );
    case 'kids':
      return [];
    case 'wellness':
      // T11 (T9 round-3 follow-up): "Price from" gets a `from ` foldPrefix
      // — a real venue's raw value can be a bare number ("500", no
      // currency/unit), which reads fine in the grid (the "Price from"
      // label sits right above it) but not once it's the lone survivor
      // folded into the meta line with no label at all.
      return withHours(
        buildChips([
          [Clock, 'Typical visit', d.typical_visit],
          [Euro, 'Price from', d.price_from, 'from '],
        ]),
        undefined,
      );
    case 'entertainment':
      return withHours(
        buildChips([
          [Clock, 'Typical show', d.typical_show_length],
          [Euro, 'Price from', d.price_from, 'from '],
        ]),
        undefined,
      );
    case 'tours_experiences':
      return buildChips([
        [Clock, 'Duration', d.duration],
        [Users, 'Group size', d.group_size],
        [LanguagesIcon, 'Languages', d.languages],
      ]);
    default:
      // ponytail: proxy sends `details: {}` (no omitempty) for every
      // activity with no category-specific data — `.category` is missing,
      // not one of the known values. Degrade to "no fact strip" instead of
      // crashing FactStrip on `fields.length` of undefined.
      return [];
  }
}

// Backend's `upcoming_shows[].date` has no fixed documented format; parse it
// as a real date for the day/numeral split when possible. When it isn't a
// parseable date (or `Intl` throws), it's still an LLM-generated value —
// T9 round-3 fix: route it through `classifyField('scalar', …)` like every
// other generated field, instead of rendering the raw string, so a
// denylisted/oversized placeholder (`"Not specified"`, `"N/A"` — 41 of 231
// live Entertainment rows carry one) omits instead of walking onto the
// screen at numeral size. `scalar` because the field is meant to be a short
// date; the spec declares no kind for it explicitly. Never throws on
// unexpected input.
//
// T11 fix: a value that passes the scalar check but still doesn't parse
// (~99 of 761 live rows — e.g. "TBA", "Q4 2026") used to land in this same
// `date` field, forcing it into the 44px-wide numeral column sized for a
// 1-2 digit day and getting visually crushed/ellipsized. That fallback now
// goes to `dateLabel` instead (an unstructured label the caller renders in
// the row body, not the numeral box) — `date`/`day` stay empty, so the
// date-block box itself omits entirely for this row, per the spec's own
// "no fallback forced into a scalar's format" absence reasoning.
function dateBlockRow(show: {
  date: string;
  title: string;
  time_or_price?: string;
}): DateBlockRow {
  const parsed = new Date(show.date);
  const valid = !Number.isNaN(parsed.getTime());
  let day = '';
  let date = '';
  if (valid) {
    try {
      day = parsed
        .toLocaleDateString(undefined, { weekday: 'short' })
        .toUpperCase();
      date = String(parsed.getDate());
    } catch {
      // ponytail: Intl unavailable — falls through to the dateLabel
      // fallback below, same as an unparseable date.
    }
  }
  const dateLabel = date ? undefined : classifyField('scalar', show.date);
  // T5 round-3 fix: `time_or_price` is LLM-generated (same field the
  // production-bug report's "Not specified" hedges leaked from on legacy
  // rows — T1 only guards new writes) — run it through `classifyField` like
  // any other generated trailing value so a leaked hedge omits per the
  // spec's "List rows" trailing-omit rule instead of rendering verbatim.
  // T5 round-4 fix: the spec declares no kind for this field; `scalar`'s
  // 18-char/4-word cap is stricter than the subline needs and newly dropped
  // legitimate legacy values (e.g. "Fri 20:00, from €15" = 19 chars). The
  // hedge this guards against is a denylist hit, which `phrase` catches
  // identically (denylist runs before the kind check) at its more permissive
  // 80-char cap — use `phrase`.
  return {
    day,
    date,
    dateLabel,
    title: show.title,
    subline: classifyField('phrase', show.time_or_price) ?? '',
  };
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
      // T9: switches from the generic "compact" density to the "duration"
      // density the spec names for Treatments (name / duration / `from €X`).
      // `price`/`duration` are both LLM-generated (same website-scrape
      // surface the bug report's "Nije navedeno" placeholders leaked from)
      // — each runs through `classifyField('scalar', …)` so a leaked
      // placeholder/sentence omits that one value (row stays, per the "List
      // rows" trailing-omit rule) instead of rendering verbatim. `item`
      // (the row's name) isn't classified, matching every other name/price
      // list's item field (popular_dishes, on_the_bar, signature_pours) —
      // none of those are declared a kind in the spec either.
      return d.treatments?.length
        ? {
            shape: 'schedule',
            heading: 'Treatments',
            density: 'duration',
            rows: d.treatments.map((t) => {
              const price = classifyField('scalar', t.price);
              return {
                name: t.item,
                duration: classifyField('scalar', t.duration),
                price: price ? `from ${stripLeadingFrom(price)}` : undefined,
              };
            }),
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
// T9: `good_to_know[]` is `phrase` kind (design-spec.md's "Kind declarations
// on existing fields" — Wellness, Entertainment, Nature all share this
// field). Every item now runs through `classifyField('phrase', …)`
// individually — an item that's over-length or denylisted is dropped, the
// rest of the list stays (same per-item survival rule as any other list),
// and 0 survivors omits the section like every other shape's empty case.
// This was the one real gap in the bug report's chain that isn't already
// covered by a scalar/shape guard elsewhere: `factStripFields` uses
// `classifyField('scalar', …)` for the stat grid and `dateBlockRow` already
// classifies its trailing subline, but this function ran no validation at
// all before this fix — see engineering-notes.md's T9 entry for why the
// bug report's own sport-equipment string still passes this check (it's a
// content-relevance defect, not a shape one, and this guard is scoped to
// shape).
export function goodToKnowSection(activity: Activity): UniqueSectionData | undefined {
  const d = activity.details;
  if (!d) return undefined;
  const raw =
    d.category === 'wellness' || d.category === 'entertainment'
      ? d.good_to_know
      : undefined;
  const items = (raw ?? [])
    .map((item) => classifyField('phrase', item))
    .filter((item): item is string => item !== undefined);
  return items.length ? { shape: 'checklist', heading: 'Good to know', items } : undefined;
}

// Shared by the two Tours helpers below — both filter a `phrase[]` field
// down to its survivors the same way (classify, drop the failures).
function classifyPhrases(items: string[] | undefined): string[] {
  return (items ?? [])
    .map((item) => classifyField('phrase', item))
    .filter((item): item is string => Boolean(item));
}

// design-spec.md's Tours & Experiences composition (T10): "What's included"
// (✓/✗ checklist) — the sole consumer of the checklist shape's new ✗
// variant (design-import mockup's slot #8 "extended" note). Each item is a
// `phrase` per the data contract, so both lists pass through
// `classifyField('phrase', …)` individually (a failing item drops on its
// own, same "items failing the phrase contract drop individually" rule the
// spec's Checklist slot states) — 0 survivors on both lists omits the whole
// section, same as every other checklist consumer's "0 items" case.
export function toursIncludedChecklist(activity: Activity): UniqueSectionData | undefined {
  const d = activity.details;
  if (!d || d.category !== 'tours_experiences') return undefined;
  const items = classifyPhrases(d.included);
  const crossItems = classifyPhrases(d.not_included);
  if (items.length === 0 && crossItems.length === 0) return undefined;
  return { shape: 'checklist', heading: "What's included", items, crossItems };
}

// design-spec.md's Tours composition: "Itinerary" (numbered rows using the
// `compact` density over `itinerary[]`) — `compact`'s existing `leading`
// slot carries the stop number here instead of a time, same shape
// Nightlife's lineup already puts there. 0 survivors omits the whole
// section (UniqueSection's own "0 rows" rule already covers this once
// `rows` is empty — no extra guard needed here beyond returning undefined
// so the heading doesn't render over zero rows).
export function toursItinerary(activity: Activity): UniqueSectionData | undefined {
  const d = activity.details;
  if (!d || d.category !== 'tours_experiences') return undefined;
  const stops = classifyPhrases(d.itinerary);
  if (stops.length === 0) return undefined;
  return {
    shape: 'schedule',
    heading: 'Itinerary',
    density: 'compact',
    rows: stops.map((stop, i) => ({
      leading: String(i + 1),
      main: stop,
      leadingStyle: 'number' as const,
    })),
  };
}

// design-spec.md's Tours composition: "Meeting point" (address + map).
// `meeting_point` is `prose` per the data contract — free text, no
// length-based rejection, only the absence rule. The map half of this slot
// is the existing Map + address slot (§B11, unchanged) — for this one
// category it renders here instead of at its usual bottom-of-screen spot
// (design-import mockup: "Tours replaces this with its own Meeting point
// map"), which is why ActivityDetailScreen gates the bottom map on this
// same value rather than rendering both.
export function toursMeetingPoint(activity: Activity): string | undefined {
  const d = activity.details;
  if (!d || d.category !== 'tours_experiences') return undefined;
  return classifyField('prose', d.meeting_point);
}

// design-spec.md's Tours meta line: "Tour · <subtype> · Meets <distance>
// away" — every other category's distance item reads plain "<n> km away"
// (or the country, Anywhere-scope); Tours prefixes "Meets" since the
// distance is to the tour's meeting point, not a venue you walk into.
// Bypasses `classifyField` like `metaText` itself — app-computed, not
// generated content.
export function metaDistanceText(activity: Activity, showDistance: boolean): string {
  if (!showDistance) return activity.country;
  const distance = `${activity.distance_km.toFixed(1)} km away`;
  return activity.category === 'tours_experiences' ? `Meets ${distance}` : distance;
}
