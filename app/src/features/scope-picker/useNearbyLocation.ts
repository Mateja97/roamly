import { useCallback, useState } from 'react';
import * as Location from 'expo-location';
import type { Coordinates } from './types';

export type NearbyLocationState =
  | { status: 'idle' }
  | { status: 'requesting-permission' }
  | { status: 'locating' }
  | { status: 'denied' }
  | { status: 'unavailable' };

type UseNearbyLocation = {
  state: NearbyLocationState;
  /** Runs the permission + GPS-fix flow; resolves with coordinates on success, null otherwise. */
  requestLocation: () => Promise<Coordinates | null>;
};

// expo-location's LocationOptions has no timeout field, so a GPS fix that
// never settles (indoors/no signal) would hang the "locating" state forever.
// ponytail: 15s is a reasonable GPS-fix bound, not a spec'd number — tune if
// real-device testing shows it's too eager/lax.
const LOCATION_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('location request timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

// Encapsulates the Nearby card's async flow (permission check → request →
// GPS fix) so ScopePickerScreen only needs to render off `state`.
export function useNearbyLocation(): UseNearbyLocation {
  const [state, setState] = useState<NearbyLocationState>({ status: 'idle' });

  const requestLocation = useCallback(async (): Promise<Coordinates | null> => {
    // Check current status first: if already denied, no OS prompt will
    // appear — jump straight to the denied message, no in-flight flash
    // (per design-spec's re-entry rule).
    const current = await Location.getForegroundPermissionsAsync();
    if (current.status === Location.PermissionStatus.DENIED) {
      setState({ status: 'denied' });
      return null;
    }

    if (current.status !== Location.PermissionStatus.GRANTED) {
      setState({ status: 'requesting-permission' });
      const requested = await Location.requestForegroundPermissionsAsync();
      if (requested.status !== Location.PermissionStatus.GRANTED) {
        setState({ status: 'denied' });
        return null;
      }
    }

    setState({ status: 'locating' });
    try {
      const position = await withTimeout(Location.getCurrentPositionAsync({}), LOCATION_TIMEOUT_MS);
      setState({ status: 'idle' });
      return { latitude: position.coords.latitude, longitude: position.coords.longitude };
    } catch {
      setState({ status: 'unavailable' });
      return null;
    }
  }, []);

  return { state, requestLocation };
}
