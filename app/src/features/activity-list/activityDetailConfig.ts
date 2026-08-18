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
  TripadvisorAttribution,
  TripadvisorReview,
} from '../../api/activities';
import type { Category } from './types';
import { classifyField } from './fieldKind';
import { CATEGORY_LABELS, SUBCATEGORIES } from './filters';
import { todayHoursRow } from './openingHours';

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
  // Mockup's Itinerary rows render `leading` as a 22px gold-bordered numbered
  // circle instead of the plain wide text column sized for a time (e.g.
  // Nightlife's `21:00`) — every other `compact` consumer omits this and
  // keeps the existing text treatment.
  leadingStyle?: 'number';
};
export type DateBlockRow = {
  day: string;
  date: string;
  // A raw `date` that's scalar-valid (passes classifyField, so it's
  // not denylisted/over-length) but doesn't parse into the structured
  // day+numeral split — set instead of `date`/`day`, rendered as an
  // unstructured muted label in the row body rather than crushed into the
  // 44px-wide numeral column sized for a 1-2 digit day (design.dc.html's
  // date-block geometry — ~99 of 761 live `upcoming_shows[].date` values
  // hit exactly this case: e.g. "TBA", "Q4 2026").
  dateLabel?: string;
  title: string;
};

export type UniqueSectionData =
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
  // `details` being present or the CTA's enabled/disabled state.
  tours_experiences: 'Check availability',
};

export function primaryCTAIsDirections(category: Category): boolean {
  return DIRECTIONS_PRIMARY.includes(category);
}

export function genericActionLabel(category: Category): 'Directions' | 'Share' {
  return primaryCTAIsDirections(category) ? 'Share' : 'Directions';
}

// website-url-action-chip T2: every category's `ActivityDetails` branch
// carries `website_url` now, so this is a plain common-property read across
// the discriminated union (no per-category switch needed) — feeds both the
// non-directions categories' primary CTA and the Website action chip.
// `undefined` only when the field is genuinely absent.
export function getWebsiteURL(activity: Activity): string | undefined {
  return activity.details?.website_url;
}

// design-spec.md's "Screen composition" section (T5): one fixed canonical
// order. Hero/title-block/action-chips/hours-row live directly in
// ActivityDetailScreen.tsx (not category-dependent); 'factstrip' below is
// the stat grid. Sections whose data is absent are still skipped by the
// renderer — this only fixes order.
export type BodySection = 'description' | 'difficulty' | 'factstrip' | 'unique' | 'goodtoknow';

const CANONICAL_BODY_ORDER: BodySection[] = ['factstrip', 'description', 'unique', 'goodtoknow'];

// "A category may promote exactly one slot above the stat grid. That is the
// entire per-category layout freedom [...]" — 'difficulty' (Sport's
// DifficultyMeter) has no canonical resting position of its own, since it
// only ever appears promoted.
//
// This table has no way to structurally exclude a slot — every category
// renders every canonical slot its data fills. That's a correct,
// data-driven consequence of the model, not a bug.
//
// Kids has an explicit entry. `factStripFields` returns `[]`
// unconditionally for kids (no stat grid per spec), so this promotion is a
// no-op on the *rendered* order (description already leads with nothing
// above it) — kept explicit anyway so this table states the spec's
// composition truthfully instead of relying on a side effect of another
// function to read as "already correct".
// Not exported — `bodySectionOrder` below is the only thing any other
// module needs.
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
// `genre` is deliberately excluded here: category-noun + subtype also
// prepend into the same row (`metaLineLeadItems`), so category + subtype +
// distance + genre + neighborhood overflows `MetaLine`'s `MAX_ITEMS = 4`
// and silently truncates neighborhood. `genre` isn't in the spec's
// canonical Entertainment meta line at all, so dropping it fixes the
// overflow without losing anything the spec asks for.
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

// Restaurants/bars are Tripadvisor-exclusive; cafés joined as a third,
// dual-sourced category per fix(activities-service) #104 ("restore Google as
// a Café source alongside Tripadvisor" — a café can genuinely come from
// either provider). Shared by `tripadvisorAttribution`/`isTripadvisorSourced`
// below so the union-narrowing switch lives in exactly one place.
function rawTripadvisorField(activity: Activity): TripadvisorAttribution | undefined {
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

// tripadvisor-marks-require-reviews (T2): the sole gate for the Tripadvisor
// treatment across every surface (ActivityCard, the list-screen footer
// caption, and — via useActivityDetailData — the eyebrow, TripadvisorBlock,
// the footer CTA, the disclaimer). A row only keeps the treatment when it
// has a quotable Tripadvisor review — `details.tripadvisor` presence alone
// is no longer enough (a review-less row falls back to the ordinary
// Google-sourced rendering instead, see `isTripadvisorSourced` below for the
// one exception that still needs the raw presence check).
export function tripadvisorAttribution(activity: Activity): TripadvisorAttribution | undefined {
  return tripadvisorReviews(activity).length > 0 ? rawTripadvisorField(activity) : undefined;
}

// tripadvisor-marks-require-reviews (T2) "rating trap": the raw
// `details.tripadvisor` presence check `tripadvisorAttribution` used to be,
// minus the review-count gate — exists ONLY to drive the rating-suppression
// rule (a Tripadvisor-sourced row's stored `activity.rating` is always
// Tripadvisor's own number until a live Places merge proves it's Google's,
// via `google_maps_uri`). Must never gate a *rendered* Tripadvisor mark —
// that's `tripadvisorAttribution`'s job alone.
export function isTripadvisorSourced(activity: Activity): boolean {
  return rawTripadvisorField(activity) !== undefined;
}

// Backend-gated per compliance rule 04 — only ever populated alongside a
// Tripadvisor-treated row. Always an array (never undefined) so callers
// (the reviews carousel) self-guard on `.length` the same way FactStrip
// self-guards on an empty fields array — up to 3.
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

// reviews-description-graceful-degrade T1: the single named gate for "does
// the Google Reviews section render at all" — moved here from
// useActivityDetailData.ts's old `googleReviewsAllowed` so a future backend
// content-mask narrowing (nulling `google_maps_uri` per category) has one
// seam to take effect at, instead of a hook-level boolean plus a duplicated
// JSX condition.
//
// Compliance: a Google-sourced reviews section (score, cards, attribution)
// must always be able to link back to Google Maps, so it never renders
// without `google_maps_uri` — no pending-state exception, since a
// seed/cached payload can carry `google_reviews`/`rating` before the live
// merge completes. This is also why a maps-link-only row (no score, no
// review cards) still renders the section: the link's presence alone is
// sufficient content — see GoogleAttributionPlate's own "Google Maps" mark +
// "View on Google Maps" link, which is the only thing that slot needs.
export function googleReviewsSectionShown(activity: Activity): boolean {
  return Boolean(activity.google_maps_uri);
}

// Companion to `googleReviewsSectionShown` above: "does the section, once
// shown, also carry the aggregate score header" — the same
// `rating > 0 && review_count !== undefined` check `ReviewsSection` itself
// gates its header on, plus the section-level compliance gate (a score can
// never render without the maps link either).
export function googleReviewsScoreShown(activity: Activity): boolean {
  return (
    googleReviewsSectionShown(activity) &&
    activity.rating > 0 &&
    activity.review_count !== undefined
  );
}

// design-spec.md T8 addendum #6: Wellness' external-booking note, lifted
// out of the Treatments rows into the bottom action bar (above the button
// row) — always present for Wellness once this data exists.
export function wellnessBookingNote(activity: Activity): string | undefined {
  const d = activity.details;
  return d?.category === 'wellness' ? d.external_booking_note : undefined;
}

// design-spec.md T8 addendum #2: the noun before the "·" is the *singular*
// category word, not the plural CATEGORY_LABELS value — every other
// category's label word is already singular (Kids stays "Kids"). Tours &
// Experiences' meta line reads "Tour · ..." (spec's own composition
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

// §5b: the eyebrow line above a Tripadvisor row's title —
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
// never from a generated field.
// `""`/absent (documented as common for the three Tripadvisor categories,
// whose subtype is only set when the per-venue Google name lookup
// succeeds) reads as "no subtype" — no fallback is invented.
export function subtypeLabel(activity: Activity): string | undefined {
  if (!activity.subcategory) return undefined;
  // `activity.category` comes off an unvalidated wire cast (api/activities.ts)
  // — a category the app doesn't yet recognize has no `SUBCATEGORIES` entry,
  // so this degrades to "no subtype" instead of crashing.
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
// category-specific meta-line content is each category's own composition
// work, not this mechanism.
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

function buildChips(
  entries: [ComponentType<LucideProps>, string, string | undefined][],
): FactChip[] {
  return entries
    .filter(
      (entry): entry is [ComponentType<LucideProps>, string, string] =>
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
  // Structured `opening_hours`, when usable, renders as its own standalone
  // HoursRow (design-spec.md's "Hours row" slot leaves the stat grid
  // entirely) — see ActivityDetailScreen's `<HoursRow>`. This helper only
  // ever appends the legacy free-text fallback chip, and only when there's
  // no usable structured data to supersede it. Omits the chip (returns
  // `chips` unchanged) when there's nothing to show.
  function withHours(chips: FactChip[], legacyHours: string | undefined): FactChip[] {
    if (todayHoursRow(activity)) return chips;
    return legacyHours ? [...chips, { icon: Clock, value: legacyHours, label: 'Hours' }] : chips;
  }
  switch (d.category) {
    case 'restaurants':
      // §5b: a Tripadvisor-sourced row carries its own cuisine (eyebrow
      // subtitle) via `tripadvisorEyebrow` above — the generic Cuisine chip
      // would just repeat that, so it's dropped for a row that keeps the
      // Tripadvisor treatment (routed through the gated helper, not the raw
      // field, so this agrees with every other Tripadvisor surface); every
      // other restaurant row keeps it. No `Price` chip (`price_tier`) for
      // any restaurant row — an LLM-scraped figure, not verifiable against
      // the venue's own site.
      return withHours(
        tripadvisorAttribution(activity) ? [] : buildChips([[Utensils, 'Cuisine', d.cuisine]]),
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
      // No `Entry` chip (`entry_price`) — LLM-scraped, not verifiable
      // against the venue's own site.
      return buildChips([
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
      // No `Duration` chip (`d.duration`) — this is the LLM-scraped
      // session duration, not the seeded Tours duration.
      return buildChips([
        [BarChart3, 'Effort', d.effort_level],
        [Wrench, 'Gear', d.gear],
      ]);
    case 'culture':
      // design-spec.md's Culture composition: `Venue`, shown only when it
      // differs from the subtype (see `venueDiffersFromSubtype`). No
      // `Tickets` chip (`ticket_price`) — LLM-scraped, not
      // verifiable. With only Venue left, a row where it matches the
      // subtype has 0 stat-grid chips (grid omits).
      return withHours(
        buildChips([[Landmark, 'Venue', venueDiffersFromSubtype(activity, d.venue_type)]]),
        d.hours,
      );
    case 'art':
      // No `Tickets` chip (`ticket_price`, art's only candidate) — LLM-
      // scraped, not verifiable. Art never has a stat-grid chip of its
      // own; only the legacy-hours fallback chip can still populate the
      // grid (or fold into the meta line as a 1-chip row).
      return withHours([], d.hours);
    case 'shopping':
      // "Best day, plus Venue when it differs from the subtype" — reuses
      // `venueDiffersFromSubtype` (same conditional Culture's stat grid
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
      // No `Typical visit`/`typical_visit` or `Price from`/`price_from`
      // chips — both LLM-scraped, neither verifiable. Wellness never has a
      // stat grid — no legacy-hours fallback either (this category has no
      // `hours` field).
      return [];
    case 'entertainment':
      // No `Typical show`/`typical_show_length` or `Price from`/
      // `price_from` chips — both LLM-scraped. Entertainment never has a
      // stat grid.
      return [];
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
// route it through `classifyField('scalar', …)` like every
// other generated field, instead of rendering the raw string, so a
// denylisted/oversized placeholder (`"Not specified"`, `"N/A"` — 41 of 231
// live Entertainment rows carry one) omits instead of walking onto the
// screen at numeral size. `scalar` because the field is meant to be a short
// date; the spec declares no kind for it explicitly. Never throws on
// unexpected input.
//
// A value that passes the scalar check but still doesn't parse
// (~99 of 761 live rows — e.g. "TBA", "Q4 2026") goes to `dateLabel`
// instead of the numeral column (an unstructured label the caller renders
// in the row body, not the numeral box, avoiding the crush/ellipsis a
// 44px-wide 1-2 digit column would cause) — `date`/`day` stay empty, so the
// date-block box itself omits entirely for this row, per the spec's own
// "no fallback forced into a scalar's format" absence reasoning.
function dateBlockRow(show: { date: string; title: string }): DateBlockRow {
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
  return { day, date, dateLabel, title: show.title };
}

// Whole-section omission lives here too: every branch returns `undefined`
// when its category's list/banner data is absent.
export function uniqueSection(
  activity: Activity,
): UniqueSectionData | undefined {
  const d = activity.details;
  if (!d) return undefined;
  switch (d.category) {
    case 'restaurants': {
      // Pills, name only. `.price` (`ItemPrice.price`) is dropped at
      // render time; the backend model keeps the field.
      // Each name runs through `classifyPhrases` (same
      // per-item survival rule as Wellness' Treatments/Tours' checklists
      // below) — a blank/invalid name drops individually instead of
      // rendering an empty pill, and 0 survivors omits the section.
      const items = classifyPhrases(d.popular_dishes?.map((item) => item.name));
      return items.length ? { shape: 'pills', heading: 'Popular dishes', items } : undefined;
    }
    case 'cafes': {
      const items = classifyPhrases(d.on_the_bar?.map((item) => item.name));
      return items.length ? { shape: 'pills', heading: 'On the bar', items } : undefined;
    }
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
            })),
          }
        : undefined;
    case 'wellness': {
      // Pills, one per surviving `item` name. `duration`/`price` aren't
      // used — both LLM-scraped, neither verifiable. Same per-item
      // `classifyField('phrase', …)` survival rule as Tours' checklists
      // (`classifyPhrases` below).
      const items = classifyPhrases(d.treatments?.map((t) => t.item));
      return items.length ? { shape: 'pills', heading: 'Treatments', items } : undefined;
    }
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
// `good_to_know[]` is `phrase` kind (design-spec.md's "Kind declarations
// on existing fields" — Wellness, Entertainment, Nature all share this
// field). Every item runs through `classifyField('phrase', …)`
// individually — an item that's over-length or denylisted is dropped, the
// rest of the list stays (same per-item survival rule as any other list),
// and 0 survivors omits the section like every other shape's empty case.
// This guard is scoped to shape (length/denylist), not content relevance —
// a syntactically fine but semantically wrong string (e.g. sport equipment
// text on the wrong field) still passes.
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
