import type { CitySuggestion } from '../../api/cities';
import type { RatingOption } from '../activity-list/types';
import type { Coordinates, Scope } from '../scope-picker/types';

// design-spec.md T2: the app's one remaining Anywhere distance range — this
// sheet's own canonical copy, not imported from `search-setup/anywhereSearch`
// (T4 deletes that whole folder once T3/T4 land; importing from a file
// scheduled for deletion would take the sheet's range down with it). Values
// currently match that file's identical MIN_DISTANCE_KM/MAX_DISTANCE_KM by
// design (Decision 5's single canonical range) — T4's retirement pass is the
// point where the app is left with exactly one copy instead of two.
export const MIN_DISTANCE_KM = 5;
export const MAX_DISTANCE_KM = 500;
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
