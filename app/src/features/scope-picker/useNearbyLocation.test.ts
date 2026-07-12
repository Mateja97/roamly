import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { useNearbyLocation } from './useNearbyLocation';

jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const mockedLocation = jest.mocked(Location);

describe('useNearbyLocation', () => {
  afterEach(() => jest.resetAllMocks());

  it('resolves coordinates once permission is granted and the GPS fix succeeds', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'undetermined' } as never);
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    mockedLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 1, longitude: 2 },
    } as never);

    const { result } = renderHook(() => useNearbyLocation());
    let coords;
    await act(async () => {
      coords = await result.current.requestLocation();
    });

    expect(coords).toEqual({ latitude: 1, longitude: 2 });
    expect(result.current.state).toEqual({ status: 'idle' });
  });

  it('goes straight to denied on re-tap when already denied (no in-flight flash)', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);

    const { result } = renderHook(() => useNearbyLocation());
    await act(async () => {
      await result.current.requestLocation();
    });

    expect(result.current.state).toEqual({ status: 'denied' });
    expect(mockedLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reports unavailable when the GPS fix fails after permission is granted', async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    mockedLocation.getCurrentPositionAsync.mockRejectedValue(new Error('timeout'));

    const { result } = renderHook(() => useNearbyLocation());
    await act(async () => {
      await result.current.requestLocation();
    });

    await waitFor(() => expect(result.current.state).toEqual({ status: 'unavailable' }));
  });
});
