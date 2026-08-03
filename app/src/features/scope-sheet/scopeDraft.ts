import type { CitySuggestion } from '../../api/cities';
import type { RatingOption } from '../activity-list/types';
import type { Coordinates, Scope } from '../scope-picker/types';
import { MAX_DISTANCE_KM, MIN_DISTANCE_KM } from '../search-setup/anywhereSearch';

// design-spec.md T2: the app's one remaining Anywhere distance range —
// reuses AnywhereSearchScreen's existing 5-500km constants rather than
// declaring a second copy. FilterSheet's separate 100-2000km range stays
// where it is (that file isn't touched here — T4 deletes it once T3/T4
// land, per product-tasks.md's explicit out-of-scope note for this task).
export { MIN_DISTANCE_KM, MAX_DISTANCE_KM };

// Reuses AnywhereSearchScreen's existing step convention (Slider step={5}).
export const DISTANCE_STEP_KM = 5;

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
