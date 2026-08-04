import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Activity } from '../../api/activities';
import { DetailMapBox } from './DetailMapBox';

const activity: Activity = {
  id: '1',
  title: 'Skadarlija Food Walk',
  description:
    'A tasty walk through the old bohemian quarter, with stops at three taverns.',
  category: 'restaurants',
  location: { lat: 44.8153, lng: 20.4646 },
  country: 'Serbia',
  rating: 4.6,
  image_refs: [{ uri: 'https://example.com/img.jpg' }],
  tags: ['food', 'walking', 'local', 'evening'],
  distance_km: 0.4,
};

describe('DetailMapBox', () => {
  const originalKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  afterEach(() => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = originalKey;
  });

  it('omits the map block entirely when the maps key is absent, app-wide', () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
    render(
      <DetailMapBox activity={activity} onPress={jest.fn()} disabled={false} />,
    );
    expect(screen.queryByTestId('activity-detail-map-image')).toBeNull();
  });

  it('shows the map image when the key is present and coordinates are valid', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(
      <DetailMapBox activity={activity} onPress={jest.fn()} disabled={false} />,
    );
    expect(screen.getByTestId('activity-detail-map-image')).toBeTruthy();
  });

  it('falls back to the pin-off placeholder when coordinates are (0,0)', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(
      <DetailMapBox
        activity={{ ...activity, location: { lat: 0, lng: 0 } }}
        onPress={jest.fn()}
        disabled
      />,
    );
    expect(screen.queryByTestId('activity-detail-map-image')).toBeNull();
  });

  it('falls back to the pin-off placeholder when the map image request fails', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(
      <DetailMapBox activity={activity} onPress={jest.fn()} disabled={false} />,
    );
    fireEvent(screen.getByTestId('activity-detail-map-image'), 'error', {
      nativeEvent: { error: 'load failed' },
    });
    expect(screen.queryByTestId('activity-detail-map-image')).toBeNull();
  });
});
