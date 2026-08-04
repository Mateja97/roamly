import type { ScopeSelection } from '../../types/scope';

export type Category =
  | 'restaurants'
  | 'cafes'
  | 'bars'
  | 'nightlife'
  | 'nature'
  | 'sport'
  | 'kids'
  | 'culture'
  | 'art'
  | 'wellness'
  | 'shopping'
  | 'entertainment'
  | 'tours_experiences';

export type RatingOption = 4.0 | 4.5 | 4.8;

// The Feed's own category/subtype pill-row state (T3/T4 — the retired
// FilterSheet used to own this shape). Only `categories`/`subtypes` are
// actually read anywhere now — `minRating`/`maxDistanceKm` moved to T2's
// `ScopeDraft` and nothing reads them off `Filters` anymore.
// ponytail: left in place rather than removed, to avoid a mechanical sweep
// of every existing `Filters` literal (production + tests) for a field two
// tasks' worth of behavior has already made dead; remove both fields (and
// this sweep) if `Filters` is touched again for an unrelated reason.
// `subtypes` holds selections across every selected category at once (one
// subtype rail per category — filters-subtypes-fix T5, then Decision 5); a
// slug only ever stays in this array while its owning category is still
// selected — see filters.ts's SUBCATEGORIES/toggleCategory's per-category
// orphan-clearing.
export type Filters = {
  categories: Category[];
  subtypes: string[];
  minRating: RatingOption | null;
  maxDistanceKm: number | null;
};

export type ActivityListScreenProps = {
  selection: ScopeSelection;
  // T4: Feed is the app's home screen now — App.tsx mounts this with no
  // previous screen to pop back to, so `onBack` is omitted there. Optional
  // (not removed outright) so this component still works standalone/in
  // tests. See ActivityListScreen's own hardware-back handler for what an
  // absent `onBack` means for Android's back button (falls through to the
  // OS default — exit — once no overlay is open to close instead).
  onBack?: () => void;
};
