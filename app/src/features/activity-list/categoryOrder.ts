import { CATEGORY_OPTIONS } from './filters';
import type { Category } from './types';

export type TimeBucket = 'morning' | 'day' | 'evening' | 'late-night';

// design-spec.md T3: "Cafés (mornings), Restaurants+Bars (evenings),
// Nightlife (after 22:00)". Boundaries are this task's own reasonable
// reading of "morning"/"evening"/"after 22:00" — the spec gives category
// names, not clock times. `day` (late-morning through late-afternoon) is
// the residual bucket with no float.
export function timeBucket(hour: number): TimeBucket {
  if (hour >= 22 || hour < 5) return 'late-night';
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'day';
}

const TIME_FLOATS: Record<TimeBucket, Category[]> = {
  morning: ['cafes'],
  evening: ['restaurants', 'bars'],
  'late-night': ['nightlife'],
  day: [],
};

// Traveler mode's own floats (Decision/Adaptivity section): "Top experiences
// here" categories move forward in the pill row too, on top of whatever the
// time bucket floats — traveler context is the more specific signal, so it
// leads.
const TRAVELER_FLOATS: Category[] = ['tours_experiences', 'culture'];

// design-spec.md T3: "stable taxonomy order except float 2-3 time-relevant
// categories to front... Recomputed on screen focus only. Selecting a
// category must not reorder the row." This function is pure and takes no
// selection state at all — the caller only ever re-invokes it on a focus
// event (mount / returning from the Detail overlay / closing the Scope
// sheet), never on a pill tap, which is what keeps that guarantee.
export function orderCategories(hour: number, travelerMode: boolean): Category[] {
  const floats = [...(travelerMode ? TRAVELER_FLOATS : []), ...TIME_FLOATS[timeBucket(hour)]];
  const floatSet = new Set(floats);
  const rest = CATEGORY_OPTIONS.map((o) => o.value).filter((c) => !floatSet.has(c));
  // De-dupe floats (traveler + time bucket could theoretically name the same
  // category — they don't today, but this keeps the row honest either way)
  // while preserving float order, then append the untouched taxonomy tail.
  const seen = new Set<Category>();
  const orderedFloats = floats.filter((c) => (seen.has(c) ? false : (seen.add(c), true)));
  return [...orderedFloats, ...rest];
}
