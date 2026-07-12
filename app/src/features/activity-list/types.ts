import type { ScopeSelection } from '../scope-picker/types';

export type Category =
  | 'food_and_drink'
  | 'history_and_culture'
  | 'nature_and_outdoors'
  | 'art_and_design'
  | 'sports'
  | 'entertainment_and_wellness';

export type PriceTier = 'budget' | 'moderate' | 'premium' | 'luxury';

export type RatingOption = 4.0 | 4.5 | 4.8;

export type DistanceOption = 10 | 25 | 50;

// The sheet's applied selection. `null` means "unset" for the single-select
// groups; an empty array means "unset" for the multi-select category group.
export type Filters = {
  categories: Category[];
  priceTier: PriceTier | null;
  minRating: RatingOption | null;
  maxDistanceKm: DistanceOption | null;
};

export type ActivityListScreenProps = {
  selection: ScopeSelection;
  onBack: () => void;
};
