import type { Category } from '../features/activity-list/types';
import type { Scope } from '../types/scope';

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
  // ponytail: attributes/recommended_visit_length are decoded and carried
  // onto the wire, but no screen renders them yet — 0/83 sampled venues
  // (Restaurants/Bars/Cafés, attractions, hotels) returned a non-empty
  // value for either. Build the UI once a real venue actually has one.
  attributes?: string[];
  recommended_visit_length?: number;
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
// this wire shape (T5 stubbed an identical copy inside
// GoogleAttributionPlate.tsx ahead of this task, since T2 hadn't landed the
// backend wire shape yet; that file now re-exports these instead of
// declaring its own). Kept camelCase — the shape GoogleAttributionPlate
// was already built and reviewed against (T5, shipped) — rather than
// reshaping that component to match the wire; `toGoogleReviews` below does
// the snake_case-to-camelCase reshape, same as `toActivityPhotos` already
// does for photos.
export type GoogleAuthorAttribution = { displayName: string; photoUri?: string; uri: string };
export type GoogleReview = {
  authorAttribution: GoogleAuthorAttribution;
  rating: number;
  text: string;
  // Raw ISO-8601 (T1's `PublishTime`) or an already-human string —
  // GoogleAttributionPlate's `formatReviewDate()` reformats the former,
  // passes the latter through verbatim.
  date: string;
};

// The wire shape (proxy-service's `googleAuthorAttributionDTO`/
// `googleReviewDTO`, confirmed against its real — built, not yet merged —
// branch `feature/proxy-public-activity-detail-t3`): snake_case,
// `publish_time` instead of `date`. `text` is already a flat string on the
// wire — proxy-service unwraps T1's nested `{text}` object server-side.
export type RawGoogleAuthorAttribution = { display_name: string; photo_uri?: string; uri: string };
export type RawGoogleReview = {
  author_attribution: RawGoogleAuthorAttribution;
  rating: number;
  text: string;
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
      // Cafés is the one dual-sourced category (#103/#104) — present only
      // for a Tripadvisor-sourced café row, same as restaurants/bars.
      tripadvisor?: TripadvisorAttribution;
      reviews?: TripadvisorReview[];
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
      // True only when `difficulty` was filled by the weekly website-scrape
      // job's own LLM estimate, never by an admin — absent for an
      // admin-entered value.
      difficulty_inferred?: boolean;
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
      // Website-sourced (weekly scrape) — never Places-sourced.
      typical_visit?: string;
      price_from?: string;
      good_to_know?: string[];
      opening_hours?: OpeningHours;
    }
  | {
      category: 'entertainment';
      genre?: string;
      neighborhood?: string;
      upcoming_shows?: { date: string; title: string; time_or_price?: string }[];
      // T7: primary CTA's external link ("Get tickets").
      action_url?: string;
      // Website-sourced (weekly scrape) — never Places-sourced.
      typical_show_length?: string;
      price_from?: string;
      good_to_know?: string[];
      opening_hours?: OpeningHours;
    }
  | {
      category: 'shopping';
      venue_type?: string;
      best_day?: string;
      hours?: string;
      what_youll_find?: string[];
      opening_hours?: OpeningHours;
    }
  | {
      // T10 (activity-detail-system): mirrors T2's backend
      // `ToursExperiencesDetails` field-for-field (same names/kinds — see
      // that struct's own doc comment). No provider populates these yet;
      // every row of this category decodes to `{}` today and the screen
      // falls back to its no-`details` state until sourcing lands.
      category: 'tours_experiences';
      duration?: string;
      group_size?: string;
      languages?: string;
      // enum-backed: "Easy" | "Moderate" | "Challenging" — kept a plain
      // string (not a literal union) to match every other backend-enum
      // field on this union (e.g. wellness's venue_type), none of which
      // narrow either; classifyField('scalar', …) still gates it.
      difficulty_level?: string;
      included?: string[];
      not_included?: string[];
      meeting_point?: string;
      itinerary?: string[];
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
  // design-spec.md's "Two rules applied to all 13" (T5): the taxonomy-
  // validated subtype slug (BUSINESS_STANDARDS.md) — always present as ""
  // on the wire (proxy-service's activityDTO has no `omitempty` on this
  // field) when unset, typed optional here only so existing fixtures
  // without it still type-check. `activityDetailConfig.ts`'s
  // `subtypeLabel` treats both `""` and `undefined` as "no subtype".
  subcategory?: string;
  // T6: Google Places live reviews, merged in by ActivityDetailScreen's
  // `getActivity` upgrade fetch. Cross-cutting across all 10 Places-sourced
  // categories (like `image_refs`), so it lives here rather than nested in
  // the per-category `details` union — mirrors T2's backend reasoning for
  // keeping `GoogleReviews` off `Details` on the Go side. Absent from a bare
  // list-query row; only ever set after a successful live merge. Shape is
  // `toGoogleReviews`'s reshaped (camelCase) output, not the wire's
  // snake_case `RawGoogleReview[]` — see that function below.
  google_reviews?: GoogleReview[];
  // T6: live Google `userRatingCount`. No display slot in design-spec.md
  // today (its rating cluster is star + number, no count) — kept wired
  // since the wire already carries it (T1's field mask pays for it) and
  // flows straight through with no reshape needed (matches this file's
  // usual snake_case top-level-field convention, same as
  // `distance_km`/`image_refs`); left unrendered rather than inventing a
  // layout the design spec doesn't call for.
  review_count?: number;
  // T6: GoogleAttributionPlate's mandatory "View on Google Maps" link
  // target (Google's attribution policy) — confirmed present on
  // proxy-service's real (built, not yet merged — branch
  // `feature/proxy-public-activity-detail-t3`) `activityDTO.google_maps_uri`
  // field, a flat string needing no reshape.
  google_maps_uri?: string;
};

// The wire may send either a plain string URL or a richer { uri,
// attribution } object per entry. Accepting both shapes here means no
// follow-up change is needed regardless of which one the backend sends.
// T6: `google_reviews` is `RawGoogleReview[]` (snake_case) on the wire,
// reshaped to `GoogleReview[]` (camelCase) by `toGoogleReviews` below —
// every other field passes through `toActivity` unchanged.
export type RawActivity = Omit<Activity, 'image_refs' | 'google_reviews'> & {
  image_refs: (string | ActivityPhoto)[];
  google_reviews?: RawGoogleReview[];
};

export type ActivitiesQueryRequest = {
  scope: Scope;
  // Device-location anchor: required for `nearby`, optional for `anywhere`
  // (denied/unavailable still queries broadly, see T2).
  current_location?: Location;
  categories?: Category[];
  // T3: subtype refinement of a single selected category (see filters.ts's
  // SUBCATEGORIES) — OR within the field, AND-ed with `categories`
  // server-side per T1's wire contract. content-first-home's T3 (2026-08)
  // moved this field's app-side role to client-side filtering
  // (filterBySubtypes) instead of sending it on the wire — kept here since
  // the wire contract/backend behavior itself is unchanged.
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

// T4: bounds the detail screen's photo-set upgrade fetch so a hung request
// can't leave it "still upgrading" forever — the caller stays on the
// provisional photo either way (design-spec.md: no error UI on failure).
export type ActivityPhotosResult =
  | { status: 'success'; image_refs: ActivityPhoto[] }
  | { status: 400 | 403 | 404 | 409 | 500; message: string };

export type ActivityResult =
  | { status: 'success'; activity: Activity }
  | { status: 400 | 403 | 404 | 409 | 500; message: string };
