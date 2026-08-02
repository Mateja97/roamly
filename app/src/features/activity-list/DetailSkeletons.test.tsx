import { render, screen } from '@testing-library/react-native';
import {
  DescriptionSkeleton,
  PLACES_LIVE_CATEGORIES,
  RatingSkeleton,
  ReviewsSkeleton,
  UniqueSectionSkeleton,
} from './DetailSkeletons';

describe('PLACES_LIVE_CATEGORIES', () => {
  it('covers the 10 Places-sourced categories and excludes Tripadvisor-sourced ones', () => {
    expect(PLACES_LIVE_CATEGORIES.has('cafes')).toBe(true);
    expect(PLACES_LIVE_CATEGORIES.has('nightlife')).toBe(true);
    expect(PLACES_LIVE_CATEGORIES.has('nature')).toBe(true);
    expect(PLACES_LIVE_CATEGORIES.has('sport')).toBe(true);
    expect(PLACES_LIVE_CATEGORIES.has('kids')).toBe(true);
    expect(PLACES_LIVE_CATEGORIES.has('culture')).toBe(true);
    expect(PLACES_LIVE_CATEGORIES.has('art')).toBe(true);
    expect(PLACES_LIVE_CATEGORIES.has('wellness')).toBe(true);
    expect(PLACES_LIVE_CATEGORIES.has('shopping')).toBe(true);
    expect(PLACES_LIVE_CATEGORIES.has('entertainment')).toBe(true);
    expect(PLACES_LIVE_CATEGORIES.has('restaurants')).toBe(false);
    expect(PLACES_LIVE_CATEGORIES.has('bars')).toBe(false);
    expect(PLACES_LIVE_CATEGORIES.has('tours_experiences')).toBe(false);
  });
});

describe('RatingSkeleton', () => {
  it('renders a single placeholder bar', () => {
    render(<RatingSkeleton />);
    expect(screen.getByTestId('rating-skeleton')).toBeTruthy();
  });
});

describe('DescriptionSkeleton', () => {
  it('renders the 3-bar placeholder', () => {
    render(<DescriptionSkeleton />);
    expect(screen.getByTestId('description-skeleton')).toBeTruthy();
  });
});

describe('UniqueSectionSkeleton', () => {
  it('renders a heading bar + checklist body for nature (its live-fillable shape)', () => {
    render(<UniqueSectionSkeleton category="nature" />);
    expect(screen.getByTestId('unique-section-skeleton')).toBeTruthy();
    expect(screen.getByTestId('unique-body-checklist')).toBeTruthy();
  });

  it('renders a heading bar + icon-grid body for kids (its live-fillable shape)', () => {
    render(<UniqueSectionSkeleton category="kids" />);
    expect(screen.getByTestId('unique-section-skeleton')).toBeTruthy();
    expect(screen.getByTestId('unique-body-icongrid')).toBeTruthy();
  });

  // Every other category's unique-section field is never in T1's live
  // mapper output (design-spec.md rule 2: don't skeleton a guaranteed
  // flash-then-collapse) — cafes/shopping/culture/art/nightlife/wellness/
  // entertainment/restaurants all render nothing here, not their config
  // shape.
  it.each(['cafes', 'shopping', 'culture', 'art', 'nightlife', 'wellness', 'entertainment', 'restaurants'] as const)(
    'renders nothing for %s (live mapper never fills its unique section)',
    (category) => {
      const { toJSON } = render(<UniqueSectionSkeleton category={category} />);
      expect(toJSON()).toBeNull();
    },
  );
});

describe('ReviewsSkeleton', () => {
  it('renders the card chrome with a brand-mark bar and two review groups', () => {
    render(<ReviewsSkeleton />);
    const card = screen.getByTestId('reviews-skeleton');
    expect(card).toBeTruthy();
    // brand-mark bar + 2 review groups + maps-link wrap = 4 direct children.
    expect(card.props.children).toHaveLength(4);
  });
});
