import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Activity } from '../../api/activities';
import { ActivityDetailScreen } from './ActivityDetailScreen';

const activity: Activity = {
  id: '1',
  title: 'Skadarlija Food Walk',
  description: 'A tasty walk through the old bohemian quarter, with stops at three taverns.',
  category: 'food_and_drink',
  location: { lat: 44.8153, lng: 20.4646 },
  country: 'Serbia',
  rating: 4.6,
  image_refs: [{ uri: 'https://example.com/img.jpg' }],
  tags: ['food', 'walking', 'local', 'evening'],
  distance_km: 0.4,
};

describe('ActivityDetailScreen', () => {
  const originalKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  afterEach(() => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = originalKey;
  });

  it('shows the full description (no snippet truncation) and every tag, uncapped', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(<ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />);

    expect(screen.getByText(activity.description)).toBeTruthy();
    expect(screen.getByText('food')).toBeTruthy();
    expect(screen.getByText('walking')).toBeTruthy();
    expect(screen.getByText('local')).toBeTruthy();
    expect(screen.getByText('evening')).toBeTruthy();
    expect(screen.getByText('Skadarlija Food Walk')).toBeTruthy();
    expect(screen.getByText('Food & Drink')).toBeTruthy();
    expect(screen.getByText('4.6')).toBeTruthy();
    expect(screen.getByText('0.4 km away')).toBeTruthy();
  });

  it('shows the country instead of distance when showDistance is false (my_country)', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(<ActivityDetailScreen activity={activity} showDistance={false} onBack={jest.fn()} />);
    expect(screen.getByText('Serbia')).toBeTruthy();
  });

  it('calls onBack when the on-screen Back control is pressed', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    const onBack = jest.fn();
    render(<ActivityDetailScreen activity={activity} showDistance onBack={onBack} />);
    fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows the broken-image fallback when the hero photo fails to load', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(<ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />);
    fireEvent(screen.getByTestId('activity-detail-hero-image'), 'error');
    expect(screen.queryByTestId('activity-detail-hero-image')).toBeNull();
  });

  it('omits the map block entirely when the maps key is absent, app-wide', () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
    render(<ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />);
    expect(screen.queryByTestId('activity-detail-map-image')).toBeNull();
  });

  it('shows the map image when the key is present and coordinates are valid', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(<ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />);
    expect(screen.getByTestId('activity-detail-map-image')).toBeTruthy();
  });

  it('falls back to the pin-off placeholder when coordinates are (0,0)', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(<ActivityDetailScreen activity={{ ...activity, location: { lat: 0, lng: 0 } }} showDistance onBack={jest.fn()} />);
    expect(screen.queryByTestId('activity-detail-map-image')).toBeNull();
  });

  it('falls back to the pin-off placeholder when the map image request fails', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(<ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />);
    fireEvent(screen.getByTestId('activity-detail-map-image'), 'error');
    expect(screen.queryByTestId('activity-detail-map-image')).toBeNull();
  });

  it('omits the tags row when tags is empty', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(<ActivityDetailScreen activity={{ ...activity, tags: [] }} showDistance onBack={jest.fn()} />);
    expect(screen.queryByText('food')).toBeNull();
  });

  it('renders no attribution caption when the hero photo carries none (no-op)', () => {
    render(<ActivityDetailScreen activity={activity} showDistance onBack={jest.fn()} />);
    expect(screen.queryByText(/photo by/i)).toBeNull();
  });

  it('shows the hero attribution as a link opening the author profile when present', () => {
    const withLink = {
      ...activity,
      image_refs: [
        {
          uri: 'https://example.com/img.jpg',
          attribution: { author: 'Jane Doe', link: 'https://maps.google.com/maps/contrib/1' },
        },
      ],
    };
    render(<ActivityDetailScreen activity={withLink} showDistance onBack={jest.fn()} />);
    expect(screen.getByRole('link', { name: 'Photo by Jane Doe' })).toBeTruthy();
  });
});
