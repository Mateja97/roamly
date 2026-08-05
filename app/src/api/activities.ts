import type { Category } from '../features/activity-list/types';
import { withTimeout } from '../utils/withTimeout';
import type {
  Activity,
  ActivityDetails,
  ActivityPhoto,
  ActivityPhotosResult,
  ActivityResult,
  ActivitiesQueryRequest,
  ActivitiesQueryResult,
  GoogleReview,
  RawActivity,
  RawGoogleReview,
} from './types';

export * from './types';

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? 'http://localhost:8080';

// T6: the wire `details` payload never carries a `category` key — it's just
// that category's own fields (confirmed against the backend's Go structs and
// seed JSON). `raw.details`'s type claims `category` but it's never really
// there at runtime; the row's top-level `category` is the only source of
// truth. Stamp it on here, once, so every consumer in activityDetailConfig.ts
// that switches on `details.category` sees real data.
function attachCategory(
  details: ActivityDetails | undefined,
  category: Category,
): ActivityDetails | undefined {
  if (!details || typeof details !== 'object') return undefined;
  return { ...details, category } as ActivityDetails;
}

// Admin-uploaded photos come back as paths relative to proxy-service
// (e.g. "/photos/<id>/<file>.jpg"); Google-sourced photos are already
// absolute https:// URLs. <Image> can't resolve a relative path on a
// device, so every uri/thumb_url must be resolved against PROXY_URL here,
// once, for every screen that renders a photo.
function resolveUri(uri: string): string {
  return /^https?:\/\//.test(uri) ? uri : `${PROXY_URL}${uri}`;
}

// Shared by toActivity and T4's getActivityPhotos — both consume the same
// wire shape (plain string or ActivityPhoto object per entry).
function toActivityPhotos(refs: (string | ActivityPhoto)[] | undefined): ActivityPhoto[] {
  return (refs ?? []).map((ref) => {
    const photo = typeof ref === 'string' ? { uri: ref } : ref;
    return {
      ...photo,
      uri: resolveUri(photo.uri),
      ...(photo.thumb_url ? { thumb_url: resolveUri(photo.thumb_url) } : {}),
    };
  });
}

// T6: reshapes the wire's snake_case Google review shape into the
// camelCase `GoogleReview` GoogleAttributionPlate.tsx (T5) already expects
// — same "reshape once, here" pattern as `toActivityPhotos` above.
// `text`/`rating` need no rename, only the nested author fields and
// `publish_time`→`date`.
function toGoogleReviews(reviews: RawGoogleReview[] | undefined): GoogleReview[] | undefined {
  return reviews?.map((r) => ({
    authorAttribution: {
      displayName: r.author_attribution.display_name,
      photoUri: r.author_attribution.photo_uri,
      uri: r.author_attribution.uri,
    },
    rating: r.rating,
    text: r.text,
    date: r.publish_time,
  }));
}

function toActivity(raw: RawActivity): Activity {
  return {
    ...raw,
    details: attachCategory(raw.details, raw.category),
    image_refs: toActivityPhotos(raw.image_refs),
    google_reviews: toGoogleReviews(raw.google_reviews),
  };
}

// product-tasks.md's T6 section specifies the photos-upgrade and
// live-details-upgrade timeouts as independently tunable per-endpoint
// values, not one shared knob — they share this constant only because both
// happen to be specified at the same 10s today; split them back into two
// named constants if either endpoint's bound ever needs to diverge.
const FETCH_TIMEOUT_MS = 10000;

const KNOWN_ERROR_STATUSES = [400, 403, 404, 409, 500] as const;
type KnownErrorStatus = (typeof KNOWN_ERROR_STATUSES)[number];

type ApiError = { status: KnownErrorStatus; message: string };

// Every endpoint's shared shape: network failure and malformed-200 both
// bucket under 500, an error body's `error` field wins over the generic
// message, and an unrecognised status narrows to 500. Callers get a
// discriminated result, never a throw (APP_STANDARDS.md, Error handling).
async function request<T>(
  url: string,
  parse: (body: unknown) => T,
  init?: RequestInit,
  timeoutMs?: number,
): Promise<({ status: 'success' } & T) | ApiError> {
  let res: Response;
  try {
    const call = fetch(url, init);
    res = timeoutMs === undefined ? await call : await withTimeout(call, timeoutMs);
  } catch {
    return { status: 500, message: 'Could not reach the server. Check your connection and try again.' };
  }

  if (res.ok) {
    try {
      return { status: 'success', ...parse(await res.json()) };
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

  const status = KNOWN_ERROR_STATUSES.includes(res.status as KnownErrorStatus)
    ? (res.status as KnownErrorStatus)
    : 500;
  return { status, message };
}

// APP_STANDARDS.md's Error handling rule: never throw an opaque error, always
// resolve to a discriminated result — success or one of the fixed statuses
// proxy-service can return, each carrying the server's message.
export async function queryActivities(body: ActivitiesQueryRequest): Promise<ActivitiesQueryResult> {
  return request(
    `${PROXY_URL}/activities/query`,
    (data) => ({ activities: (data as { activities: RawActivity[] }).activities.map(toActivity) }),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

// T4's `GET /activities/{id}/photos` (T3) — the activity's full, resolved
// photo set. Same discriminated-result convention as queryActivities; the
// detail screen (only caller) intentionally ignores the error branch's
// message and just keeps showing the provisional photo, per design-spec.md.
// Bounded by FETCH_TIMEOUT_MS so a hung request can't leave it "still
// upgrading" forever — the caller stays on the provisional photo either way
// (design-spec.md: no error UI on failure).
export async function getActivityPhotos(id: string): Promise<ActivityPhotosResult> {
  return request(
    `${PROXY_URL}/activities/${encodeURIComponent(id)}/photos`,
    (data) => ({ image_refs: toActivityPhotos((data as { image_refs: (string | ActivityPhoto)[] }).image_refs) }),
    undefined,
    FETCH_TIMEOUT_MS,
  );
}

// T6's `GET /activities/{id}` (T3, proxy-service's only public single-
// activity route — never call activities-service directly, per
// ARCHITECTURE.md) — the activity with any live-merged Places details
// (rating/details/description/reviews/maps link) T2's service layer
// resolved server-side. Same discriminated-result convention as
// queryActivities/getActivityPhotos; the detail screen (only caller)
// silently drops the error branch and keeps the seeded activity, per
// design-spec.md. Bounded by FETCH_TIMEOUT_MS, same "caller keeps showing
// what it already has either way" contract as getActivityPhotos above.
export async function getActivity(id: string): Promise<ActivityResult> {
  return request(
    `${PROXY_URL}/activities/${encodeURIComponent(id)}`,
    (raw) => ({ activity: toActivity(raw as RawActivity) }),
    undefined,
    FETCH_TIMEOUT_MS,
  );
}
