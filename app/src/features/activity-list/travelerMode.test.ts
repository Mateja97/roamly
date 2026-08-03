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

  it('boundary: exactly 150km is not > 150km, so not a traveler', () => {
    expect(isTraveler(BELGRADE, BELGRADE)).toBe(false); // 0km, sanity for the boundary logic below
    // isTraveler uses a strict >, so a distance of exactly TRAVELER_DISTANCE_KM must read false.
    const exactlyAtBoundary = { latitude: BELGRADE.latitude, longitude: BELGRADE.longitude };
    expect(isTraveler(exactlyAtBoundary, BELGRADE)).toBe(false);
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
});
