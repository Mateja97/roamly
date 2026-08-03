import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Coordinates } from '../scope-picker/types';

// design-spec.md's Adaptivity rules + Persistence section: "Home base =
// median of recent granted location samples, stored locally, no UI...
// Fewer than 3 samples => no traveler mode." A rolling, capped list — no
// need to keep every sample forever, just enough to get a stable median.
const HOME_BASE_KEY = 'roamly:home-base-samples';
const MAX_SAMPLES = 10;
const MIN_SAMPLES_FOR_HOME_BASE = 3;
export const TRAVELER_DISTANCE_KM = 150;

// APP_STANDARDS.md Error handling: a rejected/garbled read resolves to "no
// samples yet" here, once — every caller (including `recordHomeBaseSample`
// below) gets a safe value instead of an uncaught rejection.
export async function getHomeBaseSamples(): Promise<Coordinates[]> {
  try {
    const raw = await AsyncStorage.getItem(HOME_BASE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Coordinates[];
  } catch {
    return [];
  }
}

// Called whenever a fresh, granted device-location fix comes in (Nearby
// scope always implies one). Appends and caps at MAX_SAMPLES, dropping the
// oldest — a plain FIFO ring, no weighting/decay. A failed write silently
// drops this one sample (best-effort adaptivity signal, nothing user-facing
// to retry/error into) rather than throwing.
export async function recordHomeBaseSample(sample: Coordinates): Promise<void> {
  try {
    const samples = await getHomeBaseSamples();
    const next = [...samples, sample].slice(-MAX_SAMPLES);
    await AsyncStorage.setItem(HOME_BASE_KEY, JSON.stringify(next));
  } catch {
    // ponytail: swallowed — see comment above, same low-stakes local flag reasoning.
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// `null` below MIN_SAMPLES_FOR_HOME_BASE — "no traveler mode" is the only
// correct read with too little history, not a guess from 1-2 points.
export function homeBaseMedian(samples: Coordinates[]): Coordinates | null {
  if (samples.length < MIN_SAMPLES_FOR_HOME_BASE) return null;
  return {
    latitude: median(samples.map((s) => s.latitude)),
    longitude: median(samples.map((s) => s.longitude)),
  };
}

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Standard haversine great-circle distance — no existing helper in the repo
// to reuse (grepped first); every other "distance" in the app is server-
// computed (`Activity.distance_km`), which doesn't help for a client-only
// home-base comparison.
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// design-spec.md: "current fix > 150 km from home base => traveler mode."
export function isTraveler(current: Coordinates | null | undefined, homeBase: Coordinates | null): boolean {
  if (!current || !homeBase) return false;
  return distanceKm(current, homeBase) > TRAVELER_DISTANCE_KM;
}
