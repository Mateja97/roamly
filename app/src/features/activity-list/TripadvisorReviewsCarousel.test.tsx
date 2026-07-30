import { fireEvent, render, screen } from '@testing-library/react-native';
import type { TripadvisorReview } from '../../api/activities';
import { TripadvisorReviewsCarousel } from './TripadvisorReviewsCarousel';

const reviews: TripadvisorReview[] = [
  { rating: 5, date: '14 June 2026', text: 'Fantastic evening, could not fault it.' },
  { rating: 5, date: '2 June 2026', text: 'Best meal we had all trip.' },
  { rating: 5, date: '28 May 2026', text: 'Loud but the food made up for it.' },
];

describe('TripadvisorReviewsCarousel', () => {
  it('renders nothing when there are no reviews (whole section omitted, no empty state)', () => {
    const { toJSON } = render(<TripadvisorReviewsCarousel reviews={[]} />);
    expect(toJSON()).toBeNull();
  });

  it('single review: renders the card with no dots and no prev/next (a dead pager is noise)', () => {
    render(<TripadvisorReviewsCarousel reviews={[reviews[0]]} />);
    expect(screen.getByText('Tripadvisor traveler reviews')).toBeTruthy();
    expect(screen.getByText('“Fantastic evening, could not fault it.”')).toBeTruthy();
    expect(screen.getByText('A Tripadvisor traveler review')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Previous review' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next review' })).toBeNull();
    expect(screen.queryByText(/of 1/)).toBeNull();
  });

  it('multi review: renders every card, the counter, and dots/prev/next', () => {
    render(<TripadvisorReviewsCarousel reviews={reviews} />);
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect(screen.getByText('“Fantastic evening, could not fault it.”')).toBeTruthy();
    expect(screen.getByText('“Best meal we had all trip.”')).toBeTruthy();
    expect(screen.getByText('“Loud but the food made up for it.”')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous review' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next review' })).toBeTruthy();
  });

  it('shows the numeric rating and verbatim date when the review carries no rating_image_url', () => {
    render(<TripadvisorReviewsCarousel reviews={[reviews[0]]} />);
    expect(screen.getByText('Rated 5.0')).toBeTruthy();
    expect(screen.getByText('14 June 2026')).toBeTruthy();
  });

  it('renders the API-hosted bubble image (compliance rule 02) in place of the numeric rating when rating_image_url is present', () => {
    render(
      <TripadvisorReviewsCarousel
        reviews={[{ ...reviews[0], rating_image_url: 'https://tripadvisor.example/review-bubble.png' }]}
      />,
    );
    expect(screen.getByTestId('review-rating-bubble')).toBeTruthy();
    expect(screen.queryByText('Rated 5.0')).toBeNull();
    expect(screen.getByLabelText('Rated 5.0')).toBeTruthy();
    expect(screen.getByText('14 June 2026')).toBeTruthy();
  });

  it('disables the prev button on the first review and the next button on the last', () => {
    render(<TripadvisorReviewsCarousel reviews={reviews} />);
    expect(
      screen.getByRole('button', { name: 'Previous review' }).props.accessibilityState.disabled,
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Next review' }).props.accessibilityState.disabled,
    ).toBe(false);

    fireEvent.press(screen.getByRole('button', { name: 'Next review' }));
    fireEvent.press(screen.getByRole('button', { name: 'Next review' }));
    expect(screen.getByText('3 of 3')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Next review' }).props.accessibilityState.disabled,
    ).toBe(true);
  });

  it('advances the counter when the next button is pressed', () => {
    render(<TripadvisorReviewsCarousel reviews={reviews} />);
    fireEvent.press(screen.getByRole('button', { name: 'Next review' }));
    expect(screen.getByText('2 of 3')).toBeTruthy();
  });

  it('moves back when the previous button is pressed', () => {
    render(<TripadvisorReviewsCarousel reviews={reviews} />);
    fireEvent.press(screen.getByRole('button', { name: 'Next review' }));
    fireEvent.press(screen.getByRole('button', { name: 'Previous review' }));
    expect(screen.getByText('1 of 3')).toBeTruthy();
  });
});
