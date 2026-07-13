import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Activity } from '../api/activities';
import { ActivityCard, ActivityCardSkeleton } from './ActivityCard';

const activity: Activity = {
  id: '1',
  title: 'Skadarlija Food Walk',
  description: 'A tasty walk',
  category: 'food_and_drink',
  location: { lat: 44.8153, lng: 20.4646 },
  country: 'Serbia',
  price_tier: 'moderate',
  rating: 4.6,
  image_refs: ['https://example.com/img.jpg'],
  tags: ['food'],
  distance_km: 0.4,
};

describe('ActivityCard', () => {
  it('renders title, category, rating, and distance as one accessible group, with no price signage', () => {
    render(<ActivityCard activity={activity} showDistance />);
    expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy();
    expect(screen.getByText('Food & Drink')).toBeTruthy();
    expect(screen.getByText('4.6')).toBeTruthy();
    expect(screen.queryByText('$$')).toBeNull();
    const card = screen.getByLabelText(/skadarlija food walk.*food & drink.*rated 4.6.*0.4 km away/i);
    expect(card.props.accessibilityLabel).not.toMatch(/\$/);
  });

  it('shows the country instead of distance when showDistance is false (outside_country)', () => {
    render(<ActivityCard activity={activity} showDistance={false} />);
    expect(screen.getByText('Serbia')).toBeTruthy();
  });

  it('shows the broken-image fallback when the image fails to load', () => {
    render(<ActivityCard activity={activity} showDistance />);
    const image = screen.getByTestId('activity-card-image');
    fireEvent(image, 'error');
    expect(screen.queryByTestId('activity-card-image')).toBeNull();
  });

  it('renders a skeleton with the same card footprint, hidden from accessibility', () => {
    render(<ActivityCardSkeleton />);
    expect(screen.queryByText('Skadarlija Food Walk')).toBeNull();
  });
});
