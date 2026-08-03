import { useCallback, useState } from 'react';
import * as Location from 'expo-location';
import type { Coordinates } from './types';
import { LOCATION_TIMEOUT_MS, withTimeout } from './withTimeout';

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
  /**
   * Read-only status check — no OS permission prompt, no GPS fetch. Lets a
   * caller detect an already-denied permission on mount/open (e.g. the Scope
   * sheet's Nearby pane) without requestLocation's "Turn on location" tap,
   * which would OS-prompt an undetermined user just by checking. Leaves
   * `state` alone unless already denied.
   */
  checkPermission: () => Promise<void>;
};

// Encapsulates a scope ticket's async location flow (permission check →
// request → GPS fix) so ScopePickerScreen only needs to render off `state`.
// Used as two independent instances — one for Nearby, one for Anywhere's
// location anchor — since each ticket needs its own busy/error state; only
// the caller's handling of a denied/unavailable result differs between the
// two (Nearby blocks with an error, Anywhere never does).
export function useNearbyLocation(): UseNearbyLocation {
  const [state, setState] = useState<NearbyLocationState>({ status: 'idle' });

  // Shares requestLocation's first check (below) but stops there — no
  // request prompt, no GPS fetch — so it's safe to call passively on mount.
  const checkPermission = useCallback(async (): Promise<void> => {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.status === Location.PermissionStatus.DENIED) {
      setState({ status: 'denied' });
    }
  }, []);

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

  return { state, requestLocation, checkPermission };
}
