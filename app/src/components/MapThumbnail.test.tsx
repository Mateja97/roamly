import { fireEvent, render, screen } from '@testing-library/react-native';
import { MapThumbnail } from './MapThumbnail';

describe('MapThumbnail', () => {
  const original = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  afterEach(() => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = original;
  });

  it('renders nothing when the maps key is absent, app-wide', () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
    const { toJSON } = render(<MapThumbnail location={{ lat: 44.8, lng: 20.5 }} />);
    expect(toJSON()).toBeNull();
  });

  it('renders the map image when the key is present and coordinates are valid', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(<MapThumbnail location={{ lat: 44.8, lng: 20.5 }} />);
    expect(screen.getByTestId('map-thumbnail-image')).toBeTruthy();
  });

  it('shows the pin-off placeholder when coordinates are missing', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(<MapThumbnail location={undefined} />);
    expect(screen.queryByTestId('map-thumbnail-image')).toBeNull();
  });

  it('shows the pin-off placeholder when coordinates are (0,0)', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(<MapThumbnail location={{ lat: 0, lng: 0 }} />);
    expect(screen.queryByTestId('map-thumbnail-image')).toBeNull();
  });

  it('falls back to the pin-off placeholder when the image request fails', () => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
    render(<MapThumbnail location={{ lat: 44.8, lng: 20.5 }} />);
    const image = screen.getByTestId('map-thumbnail-image');
    fireEvent(image, 'error');
    expect(screen.queryByTestId('map-thumbnail-image')).toBeNull();
  });
});
