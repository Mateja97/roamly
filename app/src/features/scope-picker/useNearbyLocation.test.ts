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

  it('reports unavailable when the GPS fix hangs past the timeout, not just on an immediate rejection', async () => {
    jest.useFakeTimers();
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    // A real hung GPS fix never resolves or rejects — this promise never settles.
    mockedLocation.getCurrentPositionAsync.mockReturnValue(new Promise(() => {}) as never);

    const { result } = renderHook(() => useNearbyLocation());
    let requestPromise: Promise<unknown>;
    act(() => {
      requestPromise = result.current.requestLocation();
    });

    await waitFor(() => expect(result.current.state).toEqual({ status: 'locating' }));

    await act(async () => {
      jest.advanceTimersByTime(15000);
      await requestPromise;
    });

    expect(result.current.state).toEqual({ status: 'unavailable' });
    jest.useRealTimers();
  });

  describe('checkPermission', () => {
    it('flips state to denied when already denied, with no request/GPS call', async () => {
      mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' } as never);

      const { result } = renderHook(() => useNearbyLocation());
      await act(async () => {
        await result.current.checkPermission();
      });

      expect(result.current.state).toEqual({ status: 'denied' });
      expect(mockedLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
      expect(mockedLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
    });

    it('leaves state alone (no OS prompt) when granted or undetermined', async () => {
      mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'undetermined' } as never);

      const { result } = renderHook(() => useNearbyLocation());
      await act(async () => {
        await result.current.checkPermission();
      });

      expect(result.current.state).toEqual({ status: 'idle' });
      expect(mockedLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    });

    it('resolves true when permission is already granted', async () => {
      mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
      const { result } = renderHook(() => useNearbyLocation());
      let granted!: boolean;
      await act(async () => {
        granted = await result.current.checkPermission();
      });
      expect(granted).toBe(true);
    });

    it('resolves false when undetermined or denied', async () => {
      mockedLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'undetermined' } as never);
      const { result } = renderHook(() => useNearbyLocation());
      let granted!: boolean;
      await act(async () => {
        granted = await result.current.checkPermission();
      });
      expect(granted).toBe(false);
    });
  });
});
