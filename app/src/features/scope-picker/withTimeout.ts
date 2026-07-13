// expo-location's LocationOptions has no timeout field, so a GPS fix that
// never settles (indoors/no signal) would hang the "locating" state forever.
// ponytail: 15s is a reasonable GPS-fix bound, not a spec'd number — tune if
// real-device testing shows it's too eager/lax.
export const LOCATION_TIMEOUT_MS = 15000;

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
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
