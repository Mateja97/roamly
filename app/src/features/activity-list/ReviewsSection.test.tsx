import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ReviewsSection } from './ReviewsSection';

describe('ReviewsSection', () => {
  it('renders score, review count, and the attribution slot when the aggregate is present', () => {
    render(
      <ReviewsSection
        score={4.4}
        reviewCount={216}
        attribution={<Text>Attribution content</Text>}
      />,
    );
    expect(screen.getByText('4.4')).toBeTruthy();
    expect(screen.getByText('216 reviews')).toBeTruthy();
    expect(screen.getByText('Attribution content')).toBeTruthy();
  });

  // design-spec.md's field-specific absence: "Reviews present, aggregate
  // score absent" — the distribution bars and the large score both require
  // the aggregate; without it, render the cards/attribution slot alone.
  it('omits the score header entirely when the aggregate is absent, still renders the attribution slot', () => {
    render(<ReviewsSection attribution={<Text>Attribution content</Text>} />);
    expect(screen.queryByText('Reviews')).toBeNull();
    expect(screen.getByText('Attribution content')).toBeTruthy();
  });

  it('formats the review count with a thousands separator', () => {
    render(
      <ReviewsSection score={4.4} reviewCount={3933} attribution={<Text>x</Text>} />,
    );
    expect(screen.getByText('3,933 reviews')).toBeTruthy();
  });

  it('uses the singular "review" for a count of exactly 1', () => {
    render(<ReviewsSection score={4.4} reviewCount={1} attribution={<Text>x</Text>} />);
    expect(screen.getByText('1 review')).toBeTruthy();
  });

  it('omits "See all" when no handler is given, calls it when tapped when one is', () => {
    const onSeeAll = jest.fn();
    render(
      <ReviewsSection score={4.4} reviewCount={216} onSeeAll={onSeeAll} attribution={<Text>x</Text>} />,
    );
    fireEvent.press(screen.getByText('See all'));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it('does not render "See all" when onSeeAll is absent', () => {
    render(<ReviewsSection score={4.4} reviewCount={216} attribution={<Text>x</Text>} />);
    expect(screen.queryByText('See all')).toBeNull();
  });
});
