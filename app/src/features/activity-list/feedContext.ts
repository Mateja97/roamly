import { Globe, MapPin } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { CitySuggestion } from '../../api/cities';
import { citiesJoinLabel } from './filters';
import { timeBucket } from './categoryOrder';
import type { Scope } from '../../types/scope';
import type { RatingOption } from './types';

export type ScopePillInfo = { label: string; icon: LucideIcon };

// design-spec.md T3's three scope-pill labels: `Nearby` (MapPin) /
// `Anywhere · {city} +N` (Globe) / `Exploring everywhere` (Globe, cold
// start — also covers the "Anywhere, no city chosen yet" case, which reads
// the same as cold start to a user: broad, unanchored-by-place). T6 adds a
// fourth, orthogonal segment: an active minimum-rating filter appends
// ` · {rating}+` (same `·` separator RATING_OPTIONS' own chip labels use,
// e.g. "4.5+") so the pill's one visible/accessible string always reflects
// every scope+rating combination — no separate badge, no sheet reopen
// needed to see it's active.
export function scopePillInfo(scope: Scope, cities: CitySuggestion[], minRating: RatingOption | null): ScopePillInfo {
  const ratingSuffix = minRating === null ? '' : ` · ${minRating.toFixed(1)}+`;
  if (scope === 'nearby') return { label: `Nearby${ratingSuffix}`, icon: MapPin };
  if (cities.length === 0) return { label: `Exploring everywhere${ratingSuffix}`, icon: Globe };
  const extra = cities.length - 1;
  const base = extra > 0 ? `Anywhere · ${cities[0].city} +${extra}` : `Anywhere · ${cities[0].city}`;
  return { label: `${base}${ratingSuffix}`, icon: Globe };
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
