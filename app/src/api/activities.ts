import type { Category } from '../features/activity-list/types';
import { withTimeout } from '../features/scope-picker/withTimeout';
import type { Scope } from '../features/scope-picker/types';

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? 'http://localhost:8080';

export type Location = { lat: number; lng: number };

// T2: Google requires a photo's author attribution to travel with that
// photo wherever it's shown. Optional — absent for every photo until T3
// wires real Google Places photos through the backend.
export type PhotoAttribution = { author: string; link?: string };

// T4: thumb_url/caption are T1 backend additions, optional/absent for
// every pre-existing Google-sourced photo. thumb_url feeds the fullscreen
// viewer's thumbnail strip; caption is independent of `attribution` and
// must never suppress it (PhotoViewerModal stacks the two).
export type ActivityPhoto = {
  uri: string;
  thumb_url?: string;
  caption?: string;
  attribution?: PhotoAttribution;
};

// T3: name/price pair — Restaurants' popular dishes and Cafés' on-the-bar
// items share this shape (mirrors backend's ItemPrice).
export type ItemPrice = { name: string; price: string };

// T3 (opening-hours initiative): structured weekly hours, mirrors backend's
// `activitiessvc.OpeningHours`/`Period`. `timezone` is a plain IANA name
// (e.g. "Europe/Berlin") the app resolves against, never the device's own
// zone. A close time earlier than open rolls past midnight (backend-validated,
// never rejected here).
export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export type OpeningHoursPeriod = { day: DayOfWeek; open: string; close: string };

export type OpeningHours = {
  timezone: string;
  always_open?: boolean;
  periods?: OpeningHoursPeriod[];
};

// T3: single-block callout — Culture's "now showing" and Art's "current
// exhibition" unique sections share this shape (mirrors backend's Banner).
export type DetailBanner = { title: string; description?: string };

// fix/tripadvisor-design-fidelity: one subrating aspect's value — mirrors
// backend's `TripadvisorAspectRating`. `icon_url` is the real API-hosted
// bubble image for that aspect (Terra does return it; a prior version of
// this comment claimed otherwise — that was never checked against the live
// API). `icon_url` absent (Tripadvisor didn't supply an image for this
// aspect) is the sanctioned trigger for the numeric-fallback rendering
// (compliance rule 02: a number is compliant, a hand-redrawn bubble isn't).
export type TripadvisorAspectRating = { rating: number; icon_url?: string };

// T4: Tripadvisor's per-category rating breakdown — mirrors backend's
// `TripadvisorSubratings` (backend/shared/models/activitiessvc/activity.go).
// Each aspect is its own optional object; `omitempty` on the wire means an
// absent key here — never a fabricated 0 rating.
export type TripadvisorSubratings = {
  food?: TripadvisorAspectRating;
  service?: TripadvisorAspectRating;
  value?: TripadvisorAspectRating;
  atmosphere?: TripadvisorAspectRating;
};

// fix/tripadvisor-design-fidelity: Travelers' Choice accolade — mirrors
// backend's `TripadvisorAward`. Only ever the Travelers' Choice type (the
// backend filters out every other award type at sync time).
export type TripadvisorAward = { name: string; year: number };

// T8: Tripadvisor's required attribution for a Tripadvisor-sourced
// Restaurant/Bar row — mirrors backend's `TripadvisorAttribution`
// (backend/shared/models/activitiessvc/activity.go). Present only for
// Tripadvisor-sourced rows, never for any other row. No aggregate numeric
// rating field on the wire — the rating is carried entirely by the
// API-hosted `rating_image_url` bubble image. Award/PriceLevel/Cuisine are
// fix/tripadvisor-design-fidelity additions; `price_level` is one of
// Terra's own exact strings ("Cheap Eats"/"Mid Range"/"Fine Dining"), never
// reformatted. `cuisine` is Tripadvisor's own category label, distinct from
// `ActivityDetails`'s `cuisine` field (free-text, admin/Google rows too).
// Every optional field is omitted (never a placeholder) when Tripadvisor
// didn't return it for this location.
export type TripadvisorAttribution = {
  rating_image_url: string;
  review_count: number;
  ranking_text?: string;
  web_url: string;
  phone?: string;
  subratings?: TripadvisorSubratings;
  award?: TripadvisorAward;
  price_level?: string;
  cuisine?: string;
};

// T4: a backend-gated quoted traveler review — only ever populated for a
// 5-bubble review on a place rated >=4.0 (compliance rule 04). Up to 3 ship
// per place (T3). `rating_image_url` (fix/tripadvisor-design-fidelity) is
// the review's own real API-hosted bubble image, omitted when Tripadvisor
// didn't supply one for that specific review.
export type TripadvisorReview = {
  rating: number;
  date: string;
  text: string;
  rating_image_url?: string;
};

// T6: Google Places' per-review author attribution — canonical home for
// this wire shape. T5 stubbed a camelCase version of this inside
// GoogleAttributionPlate.tsx (T2 hadn't landed the backend wire shape
// yet); confirmed against proxy-service's actual (built, not yet merged —
// branch `feature/proxy-public-activity-detail-t3`) `googleAuthorAttributionDTO`/
// `googleReviewDTO`, this file's usual snake_case DTO convention, not
// Google's own camelCase — proxy-service's DTO already renames/flattens
// them server-side (`author_attribution.display_name`/`photo_uri`, and
// `text` is already unwrapped from T1's nested `{text}` object).
export type GoogleAuthorAttribution = { display_name: string; photo_uri?: string; uri: string };
export type GoogleReview = {
  author_attribution: GoogleAuthorAttribution;
  rating: number;
  text: string;
  // Places' raw timestamp string (T1's `PublishTime`), not pre-formatted —
  // GoogleAttributionPlate's `formatReviewDate()` formats it for display.
  publish_time: string;
};

// T3: per-category structured detail payload (T4 consumes this for the
// Activity Detail screen's fact strip + unique section). Discriminated by
// `category` so a consumer narrows to the right shape via
// `activity.category`. All fields optional/omittable, matching the
// backend's `omitempty` JSON tags and the "omit rather than blank" pattern.
export type ActivityDetails =
  | {
      category: 'restaurants';
      cuisine?: string;
      price_tier?: string;
      hours?: string;
      open_status?: string;
      popular_dishes?: ItemPrice[];
      // T7: primary CTA's external link ("Book a table").
      action_url?: string;
      // opening-hours T3: structured alternative to `open_status` above —
      // when present, supersedes it in the meta-row status slot.
      opening_hours?: OpeningHours;
      // T8: present only for Tripadvisor-sourced rows (see TripadvisorAttribution).
      tripadvisor?: TripadvisorAttribution;
      // T4: up to 3 reviews (replaces the old single `featured_review`).
      reviews?: TripadvisorReview[];
    }
  | {
      category: 'bars';
      vibe?: string;
      happy_hour_window?: string;
      opens_time?: string;
      signature_pours?: string[];
      // T7: primary CTA's external link ("See menu").
      action_url?: string;
      opening_hours?: OpeningHours;
      // T8: present only for Tripadvisor-sourced rows (see TripadvisorAttribution).
      tripadvisor?: TripadvisorAttribution;
      // T4: up to 3 reviews (replaces the old single `featured_review`).
      reviews?: TripadvisorReview[];
    }
  | {
      category: 'cafes';
      known_for_brew?: string;
      wifi_quality?: string;
      hours?: string;
      on_the_bar?: ItemPrice[];
      opening_hours?: OpeningHours;
    }
  | {
      category: 'nightlife';
      entry_price?: string;
      dress_code?: string;
      opens_time?: string;
      open_tonight?: boolean;
      lineup?: { time: string; act: string; stage: string }[];
      // T7: primary CTA's external link ("Guest list").
      action_url?: string;
      // T8: badge subtype qualifier, e.g. "Club".
      venue_type?: string;
      // opening-hours T3: structured alternative to `open_tonight` above —
      // when present, supersedes it in the meta-row status slot.
      opening_hours?: OpeningHours;
    }
  | {
      category: 'nature';
      time_to_spend?: string;
      best_time?: string;
      cost?: string;
      good_to_know?: string[];
    }
  | {
      category: 'sport';
      difficulty?: number;
      effort_level?: string;
      duration?: string;
      gear?: string;
      what_to_bring?: string[];
      // T7: primary CTA's external link ("Book session").
      action_url?: string;
      // T8: badge subtype qualifier, e.g. "Climbing".
      discipline?: string;
    }
  | {
      category: 'kids';
      age_range?: string;
      facilities?: string[];
    }
  | {
      category: 'culture';
      venue_type?: string;
      ticket_price?: string;
      hours?: string;
      now_showing?: DetailBanner;
      // T7: primary CTA's external link ("Get tickets").
      action_url?: string;
      opening_hours?: OpeningHours;
    }
  | {
      category: 'art';
      venue_type?: string;
      ticket_price?: string;
      hours?: string;
      artwork?: { artist?: string; work?: string; medium?: string };
      current_exhibition?: DetailBanner;
      // T7: primary CTA's external link ("Get tickets").
      action_url?: string;
      // T7: current exhibition's artwork year, e.g. 2019.
      year?: number;
      opening_hours?: OpeningHours;
    }
  | {
      category: 'wellness';
      treatments?: { item: string; duration?: string; price?: string }[];
      external_booking_note?: string;
      // T7: primary CTA's external link ("Visit website").
      action_url?: string;
      // T8: badge subtype qualifier, e.g. "Spa".
      venue_type?: string;
    }
  | {
      category: 'entertainment';
      genre?: string;
      neighborhood?: string;
      upcoming_shows?: { date: string; title: string; time_or_price?: string }[];
      // T7: primary CTA's external link ("Get tickets").
      action_url?: string;
    }
  | {
      category: 'shopping';
      venue_type?: string;
      best_day?: string;
      hours?: string;
      what_youll_find?: string[];
      opening_hours?: OpeningHours;
    };

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
  // T3: category-specific structured payload from T2's `details` JSONB
  // column. Optional/absent for rows with no detail data (`{}`) — T4's
  // detail screen omits the fact-strip/unique-section slot rather than
  // rendering an empty placeholder.
  details?: ActivityDetails;
  // T4: already on the wire (proxy-service's activityDTO), optional here
  // only so existing test fixtures without them still type-check — the
  // place-facts address row omits itself when both are absent.
  address?: string;
  city?: string;
  // T6: Google Places live reviews, merged in by ActivityDetailScreen's
  // `getActivity` upgrade fetch. Cross-cutting across all 10 Places-sourced
  // categories (like `image_refs`), so it lives here rather than nested in
  // the per-category `details` union — mirrors T2's backend reasoning for
  // keeping `GoogleReviews` off `Details` on the Go side. Confirmed against
  // proxy-service's real (built, unmerged) `activityDTO.google_reviews`/
  // `review_count` fields. Absent from a bare list-query row; only ever set
  // after a successful live merge.
  google_reviews?: GoogleReview[];
  review_count?: number;
  // T5/T6: GoogleAttributionPlate's mandatory "View on Google Maps" link
  // target (Google's attribution policy). Genuinely unreachable today: T1
  // captures it (`placesmap.PlaceDetail.GoogleMapsURI`), but T2's merged
  // `activitiessvc.Activity` domain type has no field for it and T3's DTO
  // (confirmed against its real, built-but-unmerged branch) has no
  // `google_maps_uri` key either — this prop is wired end-to-end here and
  // in GoogleAttributionPlate ready for whichever backend task closes that
  // gap, but will stay `undefined` (footer/maps-link never render) until
  // one does. See engineering-notes.md.
  google_maps_uri?: string;
};

// The wire format today (pre-T3) is still a plain string[] of URLs; T3 will
// move the backend to send { uri, attribution } objects. Accepting either
// per-entry shape here means this client type change ships safely before
// T3 lands, and needs no follow-up change once it does.
type RawActivity = Omit<Activity, 'image_refs'> & { image_refs: (string | ActivityPhoto)[] };

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

function toActivity(raw: RawActivity): Activity {
  return {
    ...raw,
    details: attachCategory(raw.details, raw.category),
    image_refs: toActivityPhotos(raw.image_refs),
  };
}

export type ActivitiesQueryRequest = {
  scope: Scope;
  // Device-location anchor: required for `nearby`, optional for `anywhere`
  // (denied/unavailable still queries broadly, see T2).
  current_location?: Location;
  categories?: Category[];
  // T3: subtype refinement of a single selected category (see filters.ts's
  // buildActivitiesRequest/SUBCATEGORIES) — OR within the field, AND-ed with
  // `categories` server-side per T1's wire contract.
  subcategories?: string[];
  min_rating?: number;
  max_distance_km?: number;
  // T5/T3: `anywhere` only — one-or-more city centroids to anchor distance on
  // instead of current_location (union of any-city radius).
  cities?: Location[];
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

// T4: bounds the detail screen's photo-set upgrade fetch so a hung request
// can't leave it "still upgrading" forever — the caller stays on the
// provisional photo either way (design-spec.md: no error UI on failure).
const PHOTOS_FETCH_TIMEOUT_MS = 10000;

export type ActivityPhotosResult =
  | { status: 'success'; image_refs: ActivityPhoto[] }
  | { status: 400 | 403 | 404 | 409 | 500; message: string };

// T4's `GET /activities/{id}/photos` (T3) — the activity's full, resolved
// photo set. Same discriminated-result convention as queryActivities; the
// detail screen (only caller) intentionally ignores the error branch's
// message and just keeps showing the provisional photo, per design-spec.md.
export async function getActivityPhotos(id: string): Promise<ActivityPhotosResult> {
  let res: Response;
  try {
    res = await withTimeout(fetch(`${PROXY_URL}/activities/${encodeURIComponent(id)}/photos`), PHOTOS_FETCH_TIMEOUT_MS);
  } catch {
    return { status: 500, message: 'Could not reach the server. Check your connection and try again.' };
  }

  if (res.ok) {
    try {
      const data = (await res.json()) as { image_refs: (string | ActivityPhoto)[] };
      return { status: 'success', image_refs: toActivityPhotos(data.image_refs) };
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

// T6: bounds ActivityDetailScreen's live-details upgrade fetch — same
// "caller keeps showing what it already has either way" contract as
// PHOTOS_FETCH_TIMEOUT_MS above, just a separate const per-endpoint per
// product-tasks.md's T6 section.
const ACTIVITY_FETCH_TIMEOUT_MS = 10000;

export type ActivityResult =
  | { status: 'success'; activity: Activity }
  | { status: 400 | 403 | 404 | 409 | 500; message: string };

// T6's `GET /activities/{id}` (T3, proxy-service's only public single-
// activity route — never call activities-service directly, per
// ARCHITECTURE.md) — the activity with any live-merged Places details
// (rating/details/description/reviews/maps link) T2's service layer
// resolved server-side. Same discriminated-result convention as
// queryActivities/getActivityPhotos; the detail screen (only caller)
// silently drops the error branch and keeps the seeded activity, per
// design-spec.md.
export async function getActivity(id: string): Promise<ActivityResult> {
  let res: Response;
  try {
    res = await withTimeout(fetch(`${PROXY_URL}/activities/${encodeURIComponent(id)}`), ACTIVITY_FETCH_TIMEOUT_MS);
  } catch {
    return { status: 500, message: 'Could not reach the server. Check your connection and try again.' };
  }

  if (res.ok) {
    try {
      const raw = (await res.json()) as RawActivity;
      return { status: 'success', activity: toActivity(raw) };
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
