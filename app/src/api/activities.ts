import type { Category, PriceTier } from '../features/activity-list/types';
import type { Scope } from '../features/scope-picker/types';

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? 'http://localhost:8080';

export type Location = { lat: number; lng: number };

export type Activity = {
  id: string;
  title: string;
  description: string;
  category: Category;
  location: Location;
  country: string;
  price_tier: PriceTier;
  rating: number;
  image_refs: string[];
  tags: string[];
  distance_km: number;
};

export type ActivitiesQueryRequest = {
  scope: Scope;
  current_location?: Location;
  home_location?: Location;
  home_country?: string;
  categories?: Category[];
  price_tier?: PriceTier;
  min_rating?: number;
  max_distance_km?: number;
};

// APP_STANDARDS.md's Error handling rule: never throw an opaque error, always
// resolve to a discriminated result — success or one of the fixed statuses
// proxy-service can return, each carrying the server's message.
export type ActivitiesQueryResult =
  | { status: 'success'; activities: Activity[] }
  | { status: 400 | 403 | 404 | 409 | 500; message: string };

const KNOWN_ERROR_STATUSES = [400, 403, 404, 409, 500] as const;

export async function queryActivities(body: ActivitiesQueryRequest): Promise<ActivitiesQueryResult> {
  let res: Response;
  try {
    res = await fetch(`${PROXY_URL}/activities/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Network failure — no HTTP response at all. Bucket under 500, same
    // "unexpected failure" family the server itself uses for its own errors.
    return { status: 500, message: 'Could not reach the server. Check your connection and try again.' };
  }

  if (res.ok) {
    try {
      const data = (await res.json()) as { activities: Activity[] };
      return { status: 'success', activities: data.activities };
    } catch {
      // Malformed 200 body — same discriminated-error shape as every other
      // failure path, so callers never have to special-case a thrown reject.
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
