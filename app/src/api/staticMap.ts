import type { Location } from './activities';

// Same Google Maps Platform key T4's places.ts reads (see product-tasks.md's
// cross-cutting constraint for T4/T7) — one key with both the Places and
// Maps Static APIs enabled, read from env, never hardcoded.
// EXPO_PUBLIC_-prefixed per APP_STANDARDS.md's API access rule.
export function hasMapsKey(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY);
}

// (0,0) is "null island" — never a real activity location, so it's the
// missing-coordinates sentinel alongside undefined.
export function hasValidCoordinates(location: Location | undefined): location is Location {
  return Boolean(location) && (location!.lat !== 0 || location!.lng !== 0);
}

// Google Static Maps API — one HTTP image per card/detail screen, gold pin
// baked into the image itself (decorative imagery, no token pairing
// applies). Caller must check hasMapsKey()/hasValidCoordinates() first; this
// always builds a URL. `heightPx` defaults to `widthPx` (square, the card
// thumbnail's shape); the detail screen's larger 3:2 map passes both.
export function staticMapUrl(location: Location, widthPx: number, heightPx: number = widthPx): string {
  const key = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const center = `${location.lat},${location.lng}`;
  const params = new URLSearchParams({
    center,
    zoom: '15',
    size: `${widthPx}x${heightPx}`,
    markers: `color:0xCE9042|${center}`,
    key: key ?? '',
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${params}`;
}
