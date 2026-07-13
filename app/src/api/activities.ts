import type { Category } from '../features/activity-list/types';
import type { Scope } from '../features/scope-picker/types';

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? 'http://localhost:8080';

export type Location = { lat: number; lng: number };

// T2: Google requires a photo's author attribution to travel with that
// photo wherever it's shown. Optional — absent for every photo until T3
// wires real Google Places photos through the backend.
export type PhotoAttribution = { author: string; link?: string };

export type ActivityPhoto = { uri: string; attribution?: PhotoAttribution };

export type Activity = {
  id: string;
  title: string;
  description: string;
  category: Category;
  location: Location;
  country: string;
  rating: number;
  image_refs: ActivityPhoto[];
  tags: string[];
  distance_km: number;
};

// The wire format today (pre-T3) is still a plain string[] of URLs; T3 will
// move the backend to send { uri, attribution } objects. Accepting either
// per-entry shape here means this client type change ships safely before
// T3 lands, and needs no follow-up change once it does.
type RawActivity = Omit<Activity, 'image_refs'> & { image_refs: (string | ActivityPhoto)[] };

function toActivity(raw: RawActivity): Activity {
  return {
    ...raw,
    image_refs: (raw.image_refs ?? []).map((ref) => (typeof ref === 'string' ? { uri: ref } : ref)),
  };
}

export type ActivitiesQueryRequest = {
  scope: Scope;
  current_location?: Location;
  home_location?: Location;
  home_country?: string;
  categories?: Category[];
  min_rating?: number;
  max_distance_km?: number;
  // T5's ranking flag — only meaningful (and only sent) for my_country.
  sort?: 'top_rated';
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
      const data = (await res.json()) as { activities: RawActivity[] };
      return { status: 'success', activities: data.activities.map(toActivity) };
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
