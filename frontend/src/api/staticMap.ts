import type { Location } from './adminActivities';

// Same precedent as app/src/api/staticMap.ts (Google Static Maps API), read
// via Vite's env instead of Expo's. The admin design overlays its own
// decorative wine pin in CSS (see LocationSection), so no `markers` param
// is requested here — just the centered, zoomed base image.
export function hasMapsKey(): boolean {
  return Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
}

// (0,0) is "null island" — never a real activity location, so it doubles
// as the missing-coordinates sentinel alongside `undefined`.
export function hasValidCoordinates(
  location: Location | undefined,
): location is Location {
  return location !== undefined && (location.lat !== 0 || location.lng !== 0);
}

export function staticMapUrl(
  location: Location,
  widthPx: number,
  heightPx: number = widthPx,
): string {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '';
  const params = new URLSearchParams({
    center: `${location.lat},${location.lng}`,
    zoom: '15',
    size: `${widthPx}x${heightPx}`,
    key,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${params}`;
}
