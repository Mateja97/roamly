import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  TRAVELER_DISTANCE_KM,
  distanceKm,
  getHomeBaseSamples,
  homeBaseMedian,
  isTraveler,
  recordHomeBaseSample,
} from './travelerMode';

const BELGRADE = { latitude: 44.8125, longitude: 20.4612 };
const PARIS = { latitude: 48.8566, longitude: 2.3522 };

describe('distanceKm', () => {
  it('Belgrade to Paris is roughly 1500km (real-world sanity check)', () => {
    const km = distanceKm(BELGRADE, PARIS);
    expect(km).toBeGreaterThan(1400);
    expect(km).toBeLessThan(1700);
  });

  it('same point is zero', () => {
    expect(distanceKm(BELGRADE, BELGRADE)).toBeCloseTo(0);
  });
});

describe('homeBaseMedian', () => {
  it('fewer than 3 samples => null (no home base yet)', () => {
    expect(homeBaseMedian([BELGRADE, BELGRADE])).toBeNull();
  });

  it('3+ samples => the per-axis median', () => {
    const samples = [
      { latitude: 44.8, longitude: 20.4 },
      { latitude: 44.81, longitude: 20.46 },
      { latitude: 44.82, longitude: 20.5 },
    ];
    expect(homeBaseMedian(samples)).toEqual({ latitude: 44.81, longitude: 20.46 });
  });
});

describe('isTraveler', () => {
  it('no current fix => not a traveler', () => {
    expect(isTraveler(null, BELGRADE)).toBe(false);
  });

  it('no home base yet => not a traveler', () => {
    expect(isTraveler(BELGRADE, null)).toBe(false);
  });

  it('current fix > 150km from home base => traveler', () => {
    expect(distanceKm(BELGRADE, PARIS)).toBeGreaterThan(TRAVELER_DISTANCE_KM);
    expect(isTraveler(PARIS, BELGRADE)).toBe(true);
  });

  it('current fix within 150km of home base => not a traveler', () => {
    const nearby = { latitude: 44.9, longitude: 20.5 };
    expect(distanceKm(BELGRADE, nearby)).toBeLessThan(TRAVELER_DISTANCE_KM);
    expect(isTraveler(nearby, BELGRADE)).toBe(false);
  });

  // T5 regression: the point tested below used to be `{...BELGRADE}` — the
  // same coordinates as BELGRADE itself, i.e. a 0km sanity check, not an
  // actual 150km-away point. Real geodesic points instead: moving due north
  // by `Δlat` degrees puts `dLng = 0`, which reduces `distanceKm`'s own
  // haversine formula to exactly `EARTH_RADIUS_KM * Δlat_rad` (no
  // approximation), so this is a real boundary check, not a same-point stand-in.
  const EARTH_RADIUS_KM = 6371; // matches travelerMode.ts's own constant (not exported, so restated here)
  function northOf(base: typeof BELGRADE, km: number) {
    const deltaLatDeg = (km / EARTH_RADIUS_KM) * (180 / Math.PI);
    return { latitude: base.latitude + deltaLatDeg, longitude: base.longitude };
  }

  it('boundary: a real point exactly 150km away is not > 150km, so not a traveler', () => {
    const atBoundary = northOf(BELGRADE, TRAVELER_DISTANCE_KM);
    expect(distanceKm(BELGRADE, atBoundary)).toBeCloseTo(TRAVELER_DISTANCE_KM, 3);
    expect(isTraveler(atBoundary, BELGRADE)).toBe(false);
  });

  it('boundary: a real point just past 150km away is a traveler', () => {
    const justPast = northOf(BELGRADE, TRAVELER_DISTANCE_KM + 0.01);
    expect(distanceKm(BELGRADE, justPast)).toBeGreaterThan(TRAVELER_DISTANCE_KM);
    expect(isTraveler(justPast, BELGRADE)).toBe(true);
  });
});

describe('home base sample persistence', () => {
  afterEach(async () => {
    await AsyncStorage.clear();
  });

  it('starts empty', async () => {
    expect(await getHomeBaseSamples()).toEqual([]);
  });

  it('records and reads back a sample', async () => {
    await recordHomeBaseSample(BELGRADE);
    expect(await getHomeBaseSamples()).toEqual([BELGRADE]);
  });

  it('caps the rolling window, dropping the oldest first', async () => {
    for (let i = 0; i < 12; i++) {
      await recordHomeBaseSample({ latitude: i, longitude: i });
    }
    const samples = await getHomeBaseSamples();
    expect(samples).toHaveLength(10);
    expect(samples[0]).toEqual({ latitude: 2, longitude: 2 });
    expect(samples[9]).toEqual({ latitude: 11, longitude: 11 });
  });

  it('a rejected read resolves to an empty list instead of throwing', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('boom'));
    await expect(getHomeBaseSamples()).resolves.toEqual([]);
  });

  it('a rejected write resolves instead of throwing (sample just does not persist)', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('boom'));
    await expect(recordHomeBaseSample(BELGRADE)).resolves.toBeUndefined();
  });
});
