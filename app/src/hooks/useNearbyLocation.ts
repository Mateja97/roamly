import { useCallback, useState } from 'react';
import * as Location from 'expo-location';
import type { Coordinates } from '../types/scope';
import { LOCATION_TIMEOUT_MS, withTimeout } from '../utils/withTimeout';

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
   * `state` alone unless already denied. Resolves `true` when permission is
   * already granted — lets a caller (e.g. the Feed's nearby-nudge) tell
   * "already granted, just needs a fix" apart from "genuinely not asked yet"
   * without itself duplicating the permission-status lookup.
   */
  checkPermission: () => Promise<boolean>;
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
  // review round: every caller (ScopeSheet's mount-effect check, the Feed's
  // launch-derivation effect) called this with no `.catch` of its own, and
  // neither native call was itself guarded — a rejecting
  // `getForegroundPermissionsAsync` was an unhandled promise rejection at
  // every call site (APP_STANDARDS Error handling). Fixed once, here, where
  // every caller routes through — a read failure degrades to "not granted"
  // (same as an undetermined/denied read), not a crash.
  const checkPermission = useCallback(async (): Promise<boolean> => {
    try {
      const current = await Location.getForegroundPermissionsAsync();
      if (current.status === Location.PermissionStatus.DENIED) {
        setState({ status: 'denied' });
      }
      return current.status === Location.PermissionStatus.GRANTED;
    } catch {
      return false;
    }
  }, []);

  const requestLocation = useCallback(async (): Promise<Coordinates | null> => {
    try {
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
      const position = await withTimeout(Location.getCurrentPositionAsync({}), LOCATION_TIMEOUT_MS);
      setState({ status: 'idle' });
      return { latitude: position.coords.latitude, longitude: position.coords.longitude };
    } catch {
      // Covers both the GPS-fix failure this already handled (timeout/no
      // signal) and a rejecting permission call — same "unavailable"
      // outcome/recovery (Try again / choose Anywhere) either way.
      setState({ status: 'unavailable' });
      return null;
    }
  }, []);

  return { state, requestLocation, checkPermission };
}
