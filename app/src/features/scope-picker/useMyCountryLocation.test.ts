import { renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useMyCountryLocation } from './useMyCountryLocation';

jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const mockedLocation = jest.mocked(Location);

function mockFetchOnce(body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({ json: () => Promise.resolve(body) } as never);
}

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

describe('useMyCountryLocation', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key';
  });
  afterEach(() => {
    jest.resetAllMocks();
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = ORIGINAL_ENV;
  });

  it('resolves a country name once permission, GPS fix, and geocoding all succeed', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'undetermined' } as never);
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 44.8125, longitude: 20.4612 },
    } as never);
    mockFetchOnce({
      status: 'OK',
      results: [{ address_components: [{ long_name: 'Serbia', types: ['country', 'political'] }] }],
    });

    const { result } = renderHook(() => useMyCountryLocation());

    await waitFor(() => expect(result.current).toEqual({ status: 'resolved', country: 'Serbia' }));
  });

  it('reports denied without requesting when permission is already denied', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);

    const { result } = renderHook(() => useMyCountryLocation());

    await waitFor(() => expect(result.current).toEqual({ status: 'denied' }));
    expect(mockedLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reports unavailable when the GPS fix fails after permission is granted', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    mockedLocation.getCurrentPositionAsync.mockRejectedValue(new Error('timeout'));

    const { result } = renderHook(() => useMyCountryLocation());

    await waitFor(() => expect(result.current).toEqual({ status: 'unavailable' }));
  });

  it('reports error when geocoding fails after a successful GPS fix', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 44.8125, longitude: 20.4612 },
    } as never);
    mockFetchOnce({ status: 'ZERO_RESULTS' });

    const { result } = renderHook(() => useMyCountryLocation());

    await waitFor(() => expect(result.current).toEqual({ status: 'error' }));
  });
});
