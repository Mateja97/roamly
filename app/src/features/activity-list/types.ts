import type { Activity } from '../../api/activities';
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
// `maxDistanceKm` is a continuous slider value: for `nearby` it's always a
// 1-50 number (50, the widest/ceiling, is its own "unset"/default); for
// `anywhere` `null` means "no limit" (the slider's true widest/default
// stop) — see filters.ts's `defaultFilters`.
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
  onBack: () => void;
};
