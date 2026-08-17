import { Globe, MapPin } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { CitySuggestion } from '../../api/cities';
import { citiesJoinLabel, RATING_OPTIONS, ratingAccessibilityLabel } from './filters';
import { timeBucket } from './categoryOrder';
import type { Scope } from '../../types/scope';
import type { RatingOption } from './types';

// `label` is the scope-only base text (unchanged shape, still truncatable —
// see FeedHeader's `numberOfLines`). `ratingLabel`/`ratingAccessibleLabel`
// are T6's addition, kept OUT of `label` on purpose: FeedHeader renders the
// rating as a sibling `flexShrink: 0` Text so it can never be clipped by the
// scope text's own truncation (`Exploring everywhere · 4.5+` alone already
// overflows the pill's ~176px text budget).
export type ScopePillInfo = {
  label: string;
  icon: LucideIcon;
  ratingLabel: string | null;
  ratingAccessibleLabel: string | null;
};

// design-spec.md T3's three scope-pill labels: `Nearby` (MapPin) /
// `Anywhere · {city} +N` (Globe) / `Exploring everywhere` (Globe, cold
// start — also covers the "Anywhere, no city chosen yet" case, which reads
// the same as cold start to a user: broad, unanchored-by-place). T6 adds a
// fourth, orthogonal signal: an active minimum-rating filter, surfaced via
// `ratingLabel`/`ratingAccessibleLabel` rather than folded into `label` (see
// the type comment above for why).
export function scopePillInfo(scope: Scope, cities: CitySuggestion[], minRating: RatingOption | null): ScopePillInfo {
  // Reuses RATING_OPTIONS' own "4.5+" formatting (rung 2: already in this
  // codebase) instead of re-deriving it from the raw number.
  const ratingLabel = minRating === null ? null : (RATING_OPTIONS.find((o) => o.value === minRating)?.label ?? null);
  const ratingAccessibleLabel = minRating === null ? null : ratingAccessibilityLabel(minRating);
  if (scope === 'nearby') return { label: 'Nearby', icon: MapPin, ratingLabel, ratingAccessibleLabel };
  if (cities.length === 0) return { label: 'Exploring everywhere', icon: Globe, ratingLabel, ratingAccessibleLabel };
  const extra = cities.length - 1;
  const label = extra > 0 ? `Anywhere · ${cities[0].city} +${extra}` : `Anywhere · ${cities[0].city}`;
  return { label, icon: Globe, ratingLabel, ratingAccessibleLabel };
}

// ponytail: design-spec.md T3's context-line examples name four cases
// explicitly ("This morning near you" / "Tonight near you" / "Exploring
// Barcelona & Lisbon" / traveler's "New in town? The best of {city}") but
// don't cover every reachable state — this task's own filler copy below,
// not spec text, for THREE unlisted cases: Nearby at midday, Anywhere cold
// start, and — the one the spec's own traveler line can't reach at all —
// traveler mode while scope is Nearby. Traveler detection only needs a
// device fix (works for Nearby), but naming a city needs a *chosen* city
// (`cities[0]`, Anywhere-only) — there's no reverse-geocode in this app to
// turn a Nearby coordinate into a city name, so Nearby traveler mode can
// never render the spec's literal "{city}" line. Real design gap, not
// something to resolve by inventing a geocoding feature inline; flagged for
// the designer/orchestrator. Filler below at least surfaces the traveler
// signal instead of silently reusing the non-traveler Nearby copy.
export function contextLine(
  scope: Scope,
  cities: CitySuggestion[],
  hour: number,
  travelerMode: boolean
): string {
  if (scope === 'nearby') {
    if (travelerMode) return 'New in town? Worth seeing nearby';
    const bucket = timeBucket(hour);
    if (bucket === 'morning') return 'This morning near you';
    if (bucket === 'evening' || bucket === 'late-night') return 'Tonight near you';
    return 'Right now, near you'; // filler for the day bucket — not in design-spec.md
  }

  if (cities.length > 0) {
    if (travelerMode) return `New in town? The best of ${cities[0].city}`;
    return `Exploring ${citiesJoinLabel(cities)}`;
  }

  // Anywhere cold start (no city, no traveler signal to name one) — filler,
  // not in design-spec.md.
  return 'Explore places worth the trip';
}
