import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { getCountryFromCoordinates } from '../../api/places';
import { LOCATION_TIMEOUT_MS, withTimeout } from './withTimeout';

export type MyCountryLocationState =
  | { status: 'idle' }
  | { status: 'requesting-permission' }
  | { status: 'locating' }
  | { status: 'resolving' }
  | { status: 'resolved'; country: string }
  | { status: 'denied' }
  | { status: 'unavailable' }
  | { status: 'error' };

// Runs the permission -> GPS fix -> reverse-geocode flow once, automatically,
// on mount — unlike useNearbyLocation's tap-triggered requestLocation, this
// scope needs no manual trigger: ScopePickerScreen wants the country ready
// (or failed) by the time the user looks at the card, not on tap.
export function useMyCountryLocation(): MyCountryLocationState {
  const [state, setState] = useState<MyCountryLocationState>({ status: 'idle' });

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      const current = await Location.getForegroundPermissionsAsync();
      if (current.status === Location.PermissionStatus.DENIED) {
        if (!cancelled) setState({ status: 'denied' });
        return;
      }

      if (current.status !== Location.PermissionStatus.GRANTED) {
        if (!cancelled) setState({ status: 'requesting-permission' });
        const requested = await Location.requestForegroundPermissionsAsync();
        if (requested.status !== Location.PermissionStatus.GRANTED) {
          if (!cancelled) setState({ status: 'denied' });
          return;
        }
      }

      if (!cancelled) setState({ status: 'locating' });
      let position: Location.LocationObject;
      try {
        position = await withTimeout(Location.getCurrentPositionAsync({}), LOCATION_TIMEOUT_MS);
      } catch {
        if (!cancelled) setState({ status: 'unavailable' });
        return;
      }

      if (!cancelled) setState({ status: 'resolving' });
      const result = await getCountryFromCoordinates({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      if (cancelled) return;
      setState(result.status === 'success' ? { status: 'resolved', country: result.country } : { status: 'error' });
    }

    detect();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
