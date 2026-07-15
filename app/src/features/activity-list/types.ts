import type { Activity } from '../../api/activities';
import type { CitySuggestion } from '../../api/cities';
import type { ScopeSelection } from '../scope-picker/types';

export type Category =
  | 'food_and_drink'
  | 'history_and_culture'
  | 'nature_and_outdoors'
  | 'art_and_design'
  | 'sports'
  | 'entertainment_and_wellness';

export type RatingOption = 4.0 | 4.5 | 4.8;

// The sheet's applied selection. `null` means "unset" for the single-select
// groups; an empty array means "unset" for the multi-select category group.
// `maxDistanceKm` only has a slider/control for `anywhere` — `null` there
// means "no limit" (the slider's widest/default stop). Nearby's range is
// server-fixed and never adjustable, so it's always `null` too (no slider,
// no chip, no request field) — see filters.ts's `defaultFilters`.
export type Filters = {
  categories: Category[];
  minRating: RatingOption | null;
  maxDistanceKm: number | null;
};

export type ActivityListScreenProps = {
  selection: ScopeSelection;
  // T2: the activity-types picker carries its selection forward as the
  // list's initial applied filter — arrives pre-filtered rather than
  // fetching all-types first and re-filtering client-side.
  initialCategories?: Category[];
  // T5: the Anywhere search-setup screen already ran the (cities-aware)
  // query itself — when present, this screen shows those results directly
  // instead of re-querying with an equivalent request on mount.
  initialActivities?: Activity[];
  // T2: the Anywhere search-setup screen's selected cities, carried forward
  // for the header's composite subtitle (`{count} activities · {cities}`).
  // Undefined/empty means the zero-city fallback (current_location anchor).
  initialCities?: CitySuggestion[];
  onBack: () => void;
};
