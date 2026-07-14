import type { Location } from './activities';

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? 'http://localhost:8080';

export type CitySuggestion = { city: string; country: string; centroid: Location };

// APP_STANDARDS.md's Error handling rule — same discriminated-result shape
// as queryActivities, no thrown errors.
export type CitySuggestResult =
  | { status: 'success'; suggestions: CitySuggestion[] }
  | { status: 400 | 403 | 404 | 409 | 500; message: string };

const KNOWN_ERROR_STATUSES = [400, 403, 404, 409, 500] as const;

// T4's `GET /cities/suggest?q=` — a missing/non-matching q resolves to an
// empty list (not an error); the caller is expected to call this per
// keystroke (debounced client-side, see AnywhereSearchScreen).
export async function suggestCities(query: string): Promise<CitySuggestResult> {
  let res: Response;
  try {
    res = await fetch(`${PROXY_URL}/cities/suggest?q=${encodeURIComponent(query)}`);
  } catch {
    return { status: 500, message: 'Could not reach the server. Check your connection and try again.' };
  }

  if (res.ok) {
    try {
      const data = (await res.json()) as { suggestions: CitySuggestion[] };
      return { status: 'success', suggestions: data.suggestions ?? [] };
    } catch {
      return { status: 500, message: 'Something went wrong. Please try again.' };
    }
  }

  let message = 'Something went wrong. Please try again.';
  try {
    const errorBody = (await res.json()) as { error?: string };
    if (errorBody.error) message = errorBody.error;
  } catch {
    // ponytail: non-JSON error body falls back to the generic message above.
  }

  const status = KNOWN_ERROR_STATUSES.includes(res.status as (typeof KNOWN_ERROR_STATUSES)[number])
    ? (res.status as (typeof KNOWN_ERROR_STATUSES)[number])
    : 500;
  return { status, message };
}
