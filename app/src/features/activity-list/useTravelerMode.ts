import { useEffect, useRef, useState } from 'react';
import type { Coordinates } from '../../types/scope';
import { getHomeBaseSamples, homeBaseMedian, isTraveler } from './travelerMode';

// Async by nature: the home-base median comes from AsyncStorage, so
// `travelerMode` settles a microtask after any call to `checkTravelerMode`.
export function useTravelerMode() {
  const [travelerMode, setTravelerMode] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  function checkTravelerMode(currentCoordinates: Coordinates | undefined) {
    getHomeBaseSamples().then((samples) => {
      if (!mountedRef.current) return; // avoids a post-unmount setState (e.g. a test that unmounts before this microtask settles)
      setTravelerMode(isTraveler(currentCoordinates, homeBaseMedian(samples)));
    });
  }

  return { travelerMode, checkTravelerMode };
}
