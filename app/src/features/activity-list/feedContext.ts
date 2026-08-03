import { Globe, MapPin } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { CitySuggestion } from '../../api/cities';
import { citiesJoinLabel } from './filters';
import { timeBucket } from './categoryOrder';
import type { Scope } from '../scope-picker/types';

export type ScopePillInfo = { label: string; icon: LucideIcon };

// design-spec.md T3's three scope-pill labels: `Nearby` (MapPin) /
// `Anywhere · {city} +N` (Globe) / `Exploring everywhere` (Globe, cold
// start — also covers the "Anywhere, no city chosen yet" case, which reads
// the same as cold start to a user: broad, unanchored-by-place).
export function scopePillInfo(scope: Scope, cities: CitySuggestion[]): ScopePillInfo {
  if (scope === 'nearby') return { label: 'Nearby', icon: MapPin };
  if (cities.length === 0) return { label: 'Exploring everywhere', icon: Globe };
  const extra = cities.length - 1;
  return { label: extra > 0 ? `Anywhere · ${cities[0].city} +${extra}` : `Anywhere · ${cities[0].city}`, icon: Globe };
}

// ponytail: design-spec.md T3's context-line examples name four cases
// explicitly ("This morning near you" / "Tonight near you" / "Exploring
// Barcelona & Lisbon" / traveler's "New in town? The best of {city}") but
// don't cover every reachable state (Nearby at midday, Anywhere cold start)
// — the unlisted branches below are this task's own filler copy, not spec
// text. Swap for real copy if a design pass ever covers these two states.
export function contextLine(
  scope: Scope,
  cities: CitySuggestion[],
  hour: number,
  travelerMode: boolean
): string {
  if (scope === 'nearby') {
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
