import { render, screen } from '@testing-library/react-native';
import {
  DescriptionSkeleton,
  factStripSkeletonCount,
  FactStripSkeleton,
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

describe('factStripSkeletonCount', () => {
  it('gives the max chip count for a category with a fact strip', () => {
    expect(factStripSkeletonCount('cafes')).toBe(3);
    expect(factStripSkeletonCount('shopping')).toBe(3);
  });

  it('gives 0 for a category whose fact strip never produces a chip', () => {
    expect(factStripSkeletonCount('kids')).toBe(0);
    expect(factStripSkeletonCount('wellness')).toBe(0);
    expect(factStripSkeletonCount('entertainment')).toBe(0);
  });
});

describe('RatingSkeleton', () => {
  it('renders a single placeholder bar', () => {
    render(<RatingSkeleton />);
    expect(screen.getByTestId('rating-skeleton')).toBeTruthy();
  });
});

describe('FactStripSkeleton', () => {
  it('renders one placeholder block per chip count', () => {
    const { toJSON } = render(<FactStripSkeleton count={3} />);
    expect(screen.getByTestId('fact-strip-skeleton')).toBeTruthy();
    expect(toJSON()?.children).toHaveLength(3);
  });

  it('renders nothing when the count is 0 (category has no fact strip)', () => {
    const { toJSON } = render(<FactStripSkeleton count={0} />);
    expect(toJSON()).toBeNull();
  });
});

describe('DescriptionSkeleton', () => {
  it('renders the 3-bar placeholder', () => {
    render(<DescriptionSkeleton />);
    expect(screen.getByTestId('description-skeleton')).toBeTruthy();
  });
});

describe('UniqueSectionSkeleton', () => {
  it('renders a heading bar + checklist body for nature/sport', () => {
    render(<UniqueSectionSkeleton category="nature" />);
    expect(screen.getByTestId('unique-section-skeleton')).toBeTruthy();
    expect(screen.getByTestId('unique-body-checklist')).toBeTruthy();
  });

  it('renders a name+price body for cafes', () => {
    render(<UniqueSectionSkeleton category="cafes" />);
    expect(screen.getByTestId('unique-body-nameprice')).toBeTruthy();
  });

  it('renders a pills body for shopping', () => {
    render(<UniqueSectionSkeleton category="shopping" />);
    expect(screen.getByTestId('unique-body-pills')).toBeTruthy();
  });

  it('renders an icon-grid body for kids', () => {
    render(<UniqueSectionSkeleton category="kids" />);
    expect(screen.getByTestId('unique-body-icongrid')).toBeTruthy();
  });

  it('renders a banner body with no heading bar for culture/art', () => {
    render(<UniqueSectionSkeleton category="culture" />);
    expect(screen.getByTestId('unique-body-banner')).toBeTruthy();
    // The outer wrap's only child is the banner body — no heading bar
    // rendered above it, per design-spec.md's "omitted for the banner shape".
    const wrap = screen.getByTestId('unique-section-skeleton');
    expect(wrap.children).toHaveLength(1);
  });

  it('renders a schedule-compact body for nightlife/wellness', () => {
    render(<UniqueSectionSkeleton category="wellness" />);
    expect(screen.getByTestId('unique-body-schedule-compact')).toBeTruthy();
  });

  it('renders a schedule-dateblock body for entertainment', () => {
    render(<UniqueSectionSkeleton category="entertainment" />);
    expect(screen.getByTestId('unique-body-schedule-dateblock')).toBeTruthy();
  });

  it('renders nothing for a category with no unique-section shape (restaurants)', () => {
    const { toJSON } = render(<UniqueSectionSkeleton category="restaurants" />);
    expect(toJSON()).toBeNull();
  });
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
