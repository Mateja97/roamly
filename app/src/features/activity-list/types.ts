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
// `maxDistanceKm` is a continuous 1-50 slider value (T3) rather than a
// nullable bucket — 50 (the widest/ceiling) is its own "unset"/default, per
// filters.ts's MAX_DISTANCE_KM.
export type Filters = {
  categories: Category[];
  minRating: RatingOption | null;
  maxDistanceKm: number;
};

export type ActivityListScreenProps = {
  selection: ScopeSelection;
  // T2: the activity-types picker carries its selection forward as the
  // list's initial applied filter — arrives pre-filtered rather than
  // fetching all-types first and re-filtering client-side.
  initialCategories?: Category[];
  onBack: () => void;
};
