import { fireEvent, render, screen } from '@testing-library/react-native';
import type { FeaturedReview, TripadvisorAttribution } from '../../api/activities';
import { TripadvisorBlock } from './TripadvisorBlock';

const tripadvisor: TripadvisorAttribution = {
  rating_image_url: 'https://tripadvisor.example/bubble.png',
  review_count: 1204,
  web_url: 'https://tripadvisor.example/place',
};

const review: FeaturedReview = {
  rating: 5,
  date: '14 June 2026',
  text: 'Fantastic evening, the staff could not have been more welcoming.',
};

describe('TripadvisorBlock', () => {
  it('always renders the aggregate plate + deep-link row + disclaimer', () => {
    render(
      <TripadvisorBlock tripadvisor={tripadvisor} featuredReview={undefined} ctaBusy={false} onOpenWebUrl={jest.fn()} />,
    );
    expect(screen.getByText('1,204 reviews on Tripadvisor')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Read all reviews on Tripadvisor' })).toBeTruthy();
    expect(
      screen.getByText(
        'Ratings, reviews and photos for restaurants and bars are sourced from Tripadvisor and refreshed periodically. Roamly does not rate these places.',
      ),
    ).toBeTruthy();
  });

  it('omits the featured-review block entirely when absent (no empty state)', () => {
    render(
      <TripadvisorBlock tripadvisor={tripadvisor} featuredReview={undefined} ctaBusy={false} onOpenWebUrl={jest.fn()} />,
    );
    expect(screen.queryByText('A Tripadvisor traveler review')).toBeNull();
  });

  it('renders the quoted featured review with its overline, rating/date line, and quote text when present', () => {
    render(
      <TripadvisorBlock tripadvisor={tripadvisor} featuredReview={review} ctaBusy={false} onOpenWebUrl={jest.fn()} />,
    );
    expect(screen.getByText('A Tripadvisor traveler review')).toBeTruthy();
    expect(screen.getByText('Rated 5.0 · 14 June 2026')).toBeTruthy();
    expect(screen.getByText(`“${review.text}”`)).toBeTruthy();
  });

  it('calls onOpenWebUrl when the deep-link row is pressed', () => {
    const onOpenWebUrl = jest.fn();
    render(
      <TripadvisorBlock tripadvisor={tripadvisor} featuredReview={undefined} ctaBusy={false} onOpenWebUrl={onOpenWebUrl} />,
    );
    fireEvent.press(screen.getByRole('button', { name: 'Read all reviews on Tripadvisor' }));
    expect(onOpenWebUrl).toHaveBeenCalledTimes(1);
  });

  it('disables the deep-link row while a link handoff is already in flight (ctaBusy)', () => {
    render(
      <TripadvisorBlock tripadvisor={tripadvisor} featuredReview={undefined} ctaBusy onOpenWebUrl={jest.fn()} />,
    );
    const button = screen.getByRole('button', { name: 'Read all reviews on Tripadvisor' });
    expect(button.props.accessibilityState?.disabled ?? button.props.disabled).toBeTruthy();
  });
});
