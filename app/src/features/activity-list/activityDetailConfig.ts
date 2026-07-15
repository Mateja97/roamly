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
import type { Activity } from '../../api/activities';
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
export type BodySection = 'description' | 'difficulty' | 'factstrip' | 'unique';

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
  wellness: ['description', 'unique'],
  entertainment: ['unique'],
  shopping: ['description', 'unique', 'factstrip'],
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

// The one scalar field design-spec.md places in the rating/meta row instead
// of the fact strip (Restaurants' open_status, Nightlife's live
// open_tonight boolean) — "closed" is muted, never --error (not an error).
export function openStatus(
  activity: Activity,
): { text: string; isOpen: boolean } | undefined {
  const d = activity.details;
  if (!d) return undefined;
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
  switch (d.category) {
    case 'restaurants':
      return buildChips([
        [Utensils, 'Cuisine', d.cuisine],
        [Euro, 'Price', d.price_tier],
        [Clock, 'Hours', d.hours],
      ]);
    case 'bars':
      return buildChips([
        [Martini, 'Vibe', d.vibe],
        [Clock, 'Happy hour', d.happy_hour_window],
        [Clock, 'Opens', d.opens_time],
      ]);
    case 'cafes':
      return buildChips([
        [Coffee, 'Known for', d.known_for_brew],
        [Wifi, 'Wifi', d.wifi_quality],
        [Clock, 'Hours', d.hours],
      ]);
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
      return buildChips([
        [Landmark, 'Venue', d.venue_type],
        [Euro, 'Tickets', d.ticket_price],
        [Clock, 'Hours', d.hours],
      ]);
    case 'art':
      return buildChips([
        [ImageIcon, 'Venue', d.venue_type],
        [Euro, 'Tickets', d.ticket_price],
        [Clock, 'Hours', d.hours],
      ]);
    case 'shopping':
      return buildChips([
        [Store, 'Venue', d.venue_type],
        [Calendar, 'Best day', d.best_day],
        [Clock, 'Hours', d.hours],
      ]);
    case 'kids':
    case 'wellness':
      return [];
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
