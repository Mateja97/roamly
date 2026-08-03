import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import type { GoogleReview, TripadvisorAttribution, TripadvisorReview } from '../../api/activities';
import { TripadvisorBlock } from './TripadvisorBlock';

const tripadvisor: TripadvisorAttribution = {
  rating_image_url: 'https://tripadvisor.example/bubble.png',
  review_count: 1204,
  web_url: 'https://tripadvisor.example/place',
};

const reviews: TripadvisorReview[] = [
  { rating: 5, date: '14 June 2026', text: 'Fantastic evening, the staff could not have been more welcoming.' },
];

const googleReviews: GoogleReview[] = [
  {
    authorAttribution: { displayName: 'Nina', uri: 'https://maps.google.com/contrib/1' },
    rating: 5,
    text: 'Wonderful spot, will be back.',
    date: '2026-06-01T00:00:00Z',
  },
];

function renderBlock(overrides: Partial<ComponentProps<typeof TripadvisorBlock>> = {}) {
  return render(
    <TripadvisorBlock
      tripadvisor={tripadvisor}
      rating={4.6}
      reviews={[]}
      googleReviews={[]}
      googleMapsUri={undefined}
      reviewsPending={false}
      address={undefined}
      ctaBusy={false}
      onCallPhone={jest.fn()}
      {...overrides}
    />,
  );
}

describe('TripadvisorBlock', () => {
  it('always renders the aggregate plate, including the numeric rating', () => {
    renderBlock();
    expect(screen.getByText('4.6')).toBeTruthy();
    expect(screen.getByText('1,204 reviews on Tripadvisor')).toBeTruthy();
  });

  // Bug fix: the "Read all reviews on Tripadvisor" deep-link button + its
  // disclaimer moved out of this component — they're now the trailing
  // elements of the parent screen's scrollable content, after the
  // FactStrip/map (see ActivityDetailScreen.test.tsx), not mid-block here.
  it('does not render the deep-link button or the disclaimer (moved to the parent screen)', () => {
    renderBlock();
    expect(
      screen.queryByRole('button', { name: 'Read all reviews on Tripadvisor' }),
    ).toBeNull();
    expect(
      screen.queryByText(/Roamly does not rate these places/),
    ).toBeNull();
  });

  it('omits the subratings plate when tripadvisor.subratings is absent (no empty grid)', () => {
    renderBlock();
    expect(screen.queryByText('Food')).toBeNull();
  });

  it('renders the subratings plate when present', () => {
    renderBlock({
      tripadvisor: {
        ...tripadvisor,
        subratings: {
          food: { rating: 4.5 },
          service: { rating: 4.0 },
          value: { rating: 3.5 },
          atmosphere: { rating: 5.0 },
        },
      },
    });
    expect(screen.getByText('Food')).toBeTruthy();
    expect(screen.getByText('4.5')).toBeTruthy();
  });

  it('omits the reviews carousel entirely when reviews is empty (no empty state)', () => {
    renderBlock();
    expect(screen.queryByText('Tripadvisor traveler reviews')).toBeNull();
  });

  it('renders the reviews carousel when reviews are present', () => {
    renderBlock({ reviews });
    expect(screen.getByText('Tripadvisor traveler reviews')).toBeTruthy();
    expect(screen.getByText('“Fantastic evening, the staff could not have been more welcoming.”')).toBeTruthy();
  });

  it('omits the facts block entirely when address and phone are both absent', () => {
    renderBlock();
    expect(screen.queryByLabelText(/call/i)).toBeNull();
  });

  it('renders the address row when present, non-interactive', () => {
    renderBlock({ address: 'Knez Mihailova 10, Belgrade' });
    expect(screen.getByText('Knez Mihailova 10, Belgrade')).toBeTruthy();
  });

  it('renders the phone row as a tel: link and calls onCallPhone with the number when pressed', () => {
    const onCallPhone = jest.fn();
    renderBlock({ tripadvisor: { ...tripadvisor, phone: '+381 11 123 4567' }, onCallPhone });
    const phoneLink = screen.getByRole('link', { name: 'Call +381 11 123 4567' });
    expect(phoneLink).toBeTruthy();
    fireEvent.press(phoneLink);
    expect(onCallPhone).toHaveBeenCalledWith('+381 11 123 4567');
  });

  // T4 (tripadvisor-google-review-fallback): "Empty review slot → Google
  // review cards (provider precedence)" — the three-way branch inside the
  // reviews slot.
  describe('Google review-card fallback (T4)', () => {
    it('fills the empty slot with Google review cards + attribution when Google reviews and a maps link are present', () => {
      renderBlock({ googleReviews, googleMapsUri: 'https://maps.google.com/place/xyz' });
      expect(screen.getByTestId('google-attribution-plate-detail')).toBeTruthy();
      expect(screen.getByText('Wonderful spot, will be back.')).toBeTruthy();
      expect(screen.queryByText('Tripadvisor traveler reviews')).toBeNull();
    });

    it('never renders Google cards without a maps link (compliance) — silent collapse, not empty state', () => {
      renderBlock({ googleReviews, googleMapsUri: undefined });
      expect(screen.queryByTestId('google-attribution-plate-detail')).toBeNull();
      expect(screen.queryByText('Wonderful spot, will be back.')).toBeNull();
    });

    it('collapses silently when neither provider has reviews (no skeleton, no empty frame)', () => {
      renderBlock();
      expect(screen.queryByTestId('reviews-skeleton')).toBeNull();
      expect(screen.queryByTestId('google-attribution-plate-detail')).toBeNull();
      expect(screen.queryByText('Tripadvisor traveler reviews')).toBeNull();
    });

    it('shows the existing reviews skeleton while the fallback fetch is pending, never the Google cards yet', () => {
      renderBlock({ reviewsPending: true, googleReviews, googleMapsUri: 'https://maps.google.com/place/xyz' });
      expect(screen.getByTestId('reviews-skeleton')).toBeTruthy();
      expect(screen.queryByTestId('google-attribution-plate-detail')).toBeNull();
    });

    it('Tripadvisor reviews always win, even when Google data and a pending flag are also present', () => {
      renderBlock({
        reviews,
        reviewsPending: true,
        googleReviews,
        googleMapsUri: 'https://maps.google.com/place/xyz',
      });
      expect(screen.getByText('Tripadvisor traveler reviews')).toBeTruthy();
      expect(screen.queryByTestId('reviews-skeleton')).toBeNull();
      expect(screen.queryByTestId('google-attribution-plate-detail')).toBeNull();
    });
  });

});
