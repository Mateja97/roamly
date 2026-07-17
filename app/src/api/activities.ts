import type { Category } from '../features/activity-list/types';
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

// T3: single-block callout — Culture's "now showing" and Art's "current
// exhibition" unique sections share this shape (mirrors backend's Banner).
export type DetailBanner = { title: string; description?: string };

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
    }
  | {
      category: 'bars';
      vibe?: string;
      happy_hour_window?: string;
      opens_time?: string;
      signature_pours?: string[];
      // T7: primary CTA's external link ("See menu").
      action_url?: string;
    }
  | {
      category: 'cafes';
      known_for_brew?: string;
      wifi_quality?: string;
      hours?: string;
      on_the_bar?: ItemPrice[];
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

function toActivity(raw: RawActivity): Activity {
  return {
    ...raw,
    details: attachCategory(raw.details, raw.category),
    image_refs: (raw.image_refs ?? []).map((ref) => {
      const photo = typeof ref === 'string' ? { uri: ref } : ref;
      return {
        ...photo,
        uri: resolveUri(photo.uri),
        ...(photo.thumb_url ? { thumb_url: resolveUri(photo.thumb_url) } : {}),
      };
    }),
  };
}

export type ActivitiesQueryRequest = {
  scope: Scope;
  // Device-location anchor: required for `nearby`, optional for `anywhere`
  // (denied/unavailable still queries broadly, see T2).
  current_location?: Location;
  categories?: Category[];
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
