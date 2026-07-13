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

  it('shows the country instead of distance when showDistance is false (my_country)', () => {
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

  it('renders the description snippet and up to 3 tags, both included in the a11y label', () => {
    render(<ActivityCard activity={{ ...activity, tags: ['food', 'walking', 'local', 'extra'] }} showDistance />);
    expect(screen.getByText('A tasty walk')).toBeTruthy();
    expect(screen.getByText('food')).toBeTruthy();
    expect(screen.getByText('walking')).toBeTruthy();
    expect(screen.getByText('local')).toBeTruthy();
    expect(screen.queryByText('extra')).toBeNull();
    const card = screen.getByLabelText(/a tasty walk.*tags: food, walking, local/i);
    expect(card).toBeTruthy();
  });

  it('omits the description line and its label clause when description is empty', () => {
    render(<ActivityCard activity={{ ...activity, description: '' }} showDistance />);
    expect(screen.queryByText('A tasty walk')).toBeNull();
    const card = screen.getByLabelText(/skadarlija food walk/i);
    expect(card.props.accessibilityLabel).not.toMatch(/tasty walk/i);
  });

  it('omits the tags row and its label clause when tags is empty', () => {
    render(<ActivityCard activity={{ ...activity, tags: [] }} showDistance />);
    expect(screen.queryByText('food')).toBeNull();
    const card = screen.getByLabelText(/skadarlija food walk/i);
    expect(card.props.accessibilityLabel).not.toMatch(/tags:/i);
  });
});
