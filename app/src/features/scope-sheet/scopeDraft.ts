import type { CitySuggestion } from '../../api/cities';
import type { RatingOption } from '../activity-list/types';
import type { Coordinates, Scope } from '../../types/scope';

// design-spec.md T1: the app's one canonical Anywhere distance scale — seven
// evenly-spaced stops (DESIGN_STANDARDS.md's Slider "Stepped variant") instead
// of a linear 5-500km range. The control is driven by the stop's *index*
// (0..DISTANCE_STOPS_KM.length, the last being the open-ended "Any" stop);
// these two helpers are the only place that index<->value mapping happens.
export const DISTANCE_STOPS_KM = [5, 10, 25, 50, 100, 200] as const;

// `null` (Nearby's permanent value, and Anywhere's default) maps to the open-
// ended stop one index past the last real stop. A value that isn't on the
// list (e.g. a value from before this scale existed) snaps to its nearest
// stop — never a fractional index.
export function distanceIndex(maxDistanceKm: number | null): number {
  if (maxDistanceKm === null) return DISTANCE_STOPS_KM.length;
  return DISTANCE_STOPS_KM.reduce(
    (nearest, km, i) => (Math.abs(km - maxDistanceKm) < Math.abs(DISTANCE_STOPS_KM[nearest] - maxDistanceKm) ? i : nearest),
    0
  );
}

// Inverse of distanceIndex. Index 6 (past the array's last element) resolves
// via `??` to `null`, the "Any" sentinel.
export function distanceAtIndex(index: number): number | null {
  return DISTANCE_STOPS_KM[index] ?? null;
}

// The sheet's draft selection — everything Screen 3 (design-spec.md) owns.
// No categories/subtypes here: those live on the Feed (T3), not this sheet.
export type ScopeDraft = {
  scope: Scope;
  // Device-location anchor. Present once resolved, for either scope:
  // Nearby needs one to show its "granted" pane; Anywhere uses it only
  // when no city is selected (see anywhereHasAnchor below).
  coordinates?: Coordinates;
  // Anywhere-only — always empty for `nearby`.
  cities: CitySuggestion[];
  // Anywhere-only; `null` = "no limit" (also Nearby's permanent value —
  // its range is server-fixed, never adjustable, never sent).
  maxDistanceKm: number | null;
  minRating: RatingOption | null;
};

// `coordinates` is a separate param (not swallowed by "defaults") so Reset
// (which must not undo an already-granted device location) can call this
// with the draft's current coordinates while still zeroing every other
// field back to its widest/unset value.
export function defaultScopeDraft(scope: Scope, coordinates?: Coordinates): ScopeDraft {
  return { scope, coordinates, cities: [], maxDistanceKm: null, minRating: null };
}

// Anywhere's distance slider is meaningless without something to measure a
// radius from — same "Hidden state" rule FilterSheet's DistanceSlider
// already follows for its own anchor gate (omit the group, never show it
// disabled).
export function anywhereHasAnchor(draft: Pick<ScopeDraft, 'cities' | 'coordinates'>): boolean {
  return draft.cities.length > 0 || draft.coordinates !== undefined;
}

// Shared by ScopeSheet (typeahead effect, select/removeCity) and its
// AnywherePane — living here, not either of those files, keeps neither
// having to import the other.
export type CityFetchState = { query: string; status: 'results' | 'no-match' | 'error'; results: CitySuggestion[]; error: string | null };

export function cityKey(city: CitySuggestion): string {
  return `${city.city}|${city.country}`;
}
