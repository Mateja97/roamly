import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import type { Activity, ActivityPhoto } from '../../api/activities';
import { getActivity, getActivityPhotos } from '../../api/activities';
import { classifyField } from './fieldKind';
import {
  artAttribution,
  factStripFields,
  genericActionLabel,
  getWebsiteURL,
  goodToKnowSection,
  isTripadvisorSourced,
  kidsAgeLabel,
  metaDistanceText,
  metaRowExtras,
  primaryCTAIsDirections,
  toursIncludedChecklist,
  toursItinerary,
  toursMeetingPoint,
  tripadvisorAddressLine,
  tripadvisorAttribution,
  tripadvisorEyebrow,
  tripadvisorReviews,
  uniqueSection,
  wellnessBookingNote,
} from './activityDetailConfig';
import {
  nightlifeTonightChip,
  openStatus,
  todayHoursRow,
  weekHoursModalData,
} from './openingHours';
import { PLACES_LIVE_CATEGORIES } from './DetailSkeletons';
import { classifyFactChips } from './FactStrip';

// True when a live merge genuinely put something new on screen — used
// to gate the "Place details added" a11y announcement (a merge that
// collapsed every block, e.g. a category the mapper can't fill anything
// for, has nothing to tell an AT user arrived).
function hasLiveContent(a: Activity): boolean {
  const detailKeys = Object.keys(a.details ?? {}).filter((key) => key !== 'category');
  return (
    a.rating > 0 ||
    Boolean(a.description) ||
    detailKeys.length > 0 ||
    (a.google_reviews?.length ?? 0) > 0 ||
    Boolean(a.google_maps_uri)
  );
}

export function useActivityDetailData(seedActivity: Activity, showDistance: boolean) {
  // Starts as the provisional list data, upgrades in place once
  // GET /activities/{id}/photos resolves. `image_refs[0]` is guaranteed to
  // stay the same photo pre/post-upgrade, so the hero never swaps/reloads —
  // only `photos.length` (the count pill) and the viewer's slide count
  // change. Failure/timeout leaves this untouched — no error UI, per
  // design-spec.md. ActivityListScreen only ever mounts this screen fresh
  // per open (`{selectedActivity && <ActivityDetailScreen .../>}`), never
  // swaps `activity` on an already-mounted instance, so there's no
  // reset-on-prop-change case to handle here.
  const [photos, setPhotos] = useState<ActivityPhoto[]>(seedActivity.image_refs);
  // HeroCarousel pages through `photos` internally — this mirrors its
  // current page so the below-hero attribution caption tracks the photo
  // actually being viewed, not always photos[0] (attribution must travel
  // with the photo, per api/activities.ts's PhotoAttribution doc).
  const [heroIndex, setHeroIndex] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getActivityPhotos(seedActivity.id).then((result) => {
      if (!cancelled && result.status === 'success') setPhotos(result.image_refs);
    });
    return () => {
      cancelled = true;
    };
  }, [seedActivity.id]);

  // Seeds `activity` state from the passed prop (frame one, no waiting —
  // design-spec.md's "Progressive enrichment"), then merges the
  // Places-backed fields (rating/details/description/reviews/maps link)
  // onto it once getActivity(id) resolves. Every other field on `activity`
  // below (title/tags/location/category/etc.) is never reassigned, so it's
  // always identical to `seedActivity`. Cancelled-effect guard mirrors the
  // photos effect above; failure/timeout is silently dropped (design-spec.md:
  // no error UI for content the user never saw).
  const [activity, setActivity] = useState<Activity>(seedActivity);
  // Cafés is the one category that can be either Tripadvisor- or
  // Google-sourced (#103/#104) — a Tripadvisor-sourced café must stay
  // Tripadvisor-treated only, same as a Tripadvisor restaurant/bar, so this
  // excludes any row `tripadvisorAttribution` already claims.
  // tripadvisor-marks-require-reviews (T2): restaurants/bars aren't in
  // PLACES_LIVE_CATEGORIES (their content is normally synchronous from the
  // Tripadvisor row) — but a review-less Tripadvisor row (any of the 3 TA
  // categories, cafés included) needs the exact same live Places round trip
  // as any Places-live category, since its content is now Google's, fetched
  // the same way. `seedTripadvisorSourced` widens the predicate to cover it;
  // `tripadvisorAttribution` being gated to undefined for a review-less row
  // (and truthy for one that keeps its own reviews) still excludes the rows
  // that don't need it. Computed once here (not inline in the effect below)
  // so the effect's own dependency array can name it directly instead of
  // depending on the whole `seedActivity` object.
  const seedTripadvisorSourced = isTripadvisorSourced(seedActivity);
  const isPlacesLive =
    (PLACES_LIVE_CATEGORIES.has(seedActivity.category) || seedTripadvisorSourced) &&
    !tripadvisorAttribution(seedActivity);
  // A Tripadvisor row with its own reviews (or any other non-Places-live,
  // non-fallback row) is never skeletoned and the merge can't improve it, so
  // it starts (and stays) settled — the effect below skips the round trip
  // entirely for it, rather than fetch-and-discard on every open.
  const [detailsPending, setDetailsPending] = useState(isPlacesLive);
  useEffect(() => {
    if (!isPlacesLive) return;
    let cancelled = false;
    // design-spec.md's Accessibility notes: one polite loading status for
    // the whole enriching region.
    AccessibilityInfo.announceForAccessibility('Loading place details');
    getActivity(seedActivity.id).then((result) => {
      if (cancelled) return;
      if (result.status === 'success') {
        const merged = result.activity;
        setActivity((prev) => ({
          ...prev,
          rating: merged.rating,
          details: merged.details,
          // Server-side merge already never blanks a good stored value —
          // this `||` is belt-and-suspenders against the same mistake here.
          description: merged.description || prev.description,
          google_reviews: merged.google_reviews,
          google_maps_uri: merged.google_maps_uri,
          // ReviewsSection's score header needs this alongside `rating`.
          review_count: merged.review_count,
        }));
        // Only announce "added" when the merge genuinely put something new
        // on screen — a merge that collapsed every block is nothing to
        // tell an AT user arrived. On a review-less Tripadvisor row,
        // `hasLiveContent` is useless as that gate: `merged.details` still
        // always carries the `tripadvisor`/`reviews` keys (the backend
        // doesn't strip them), so `detailKeys.length > 0` would read "true"
        // even when the widened fetch found nothing new — check the same
        // `googleReviews.length > 0 && googleMapsUri` condition the Reviews
        // slot itself renders cards on instead.
        const addedLiveContent = seedTripadvisorSourced
          ? (merged.google_reviews?.length ?? 0) > 0 && Boolean(merged.google_maps_uri)
          : hasLiveContent(merged);
        if (addedLiveContent) AccessibilityInfo.announceForAccessibility('Place details added');
      }
      setDetailsPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [seedActivity.id, isPlacesLive, seedTripadvisorSourced]);

  const metaText = metaDistanceText(activity, showDistance);
  const status = openStatus(activity);
  // design-spec.md's Tours & Experiences composition: "Tour · <subtype> ·
  // Meets <distance> away" + a level chip (never the difficulty meter —
  // that's Sport's). Mutually exclusive with the status chip below (Tours
  // never has one — not in `openingHoursOf`'s switch, no
  // `open_status`/`open_tonight` fields).
  const levelChipText =
    activity.details?.category === 'tours_experiences'
      ? classifyField('scalar', activity.details.difficulty_level)
      : undefined;
  // When this is defined, it supersedes the meta row's own Open/Closed item
  // below (single home for the status, per design-spec.md) — the standalone
  // HoursRow (see below) owns the actual rendering of today's status/hours,
  // so this flag only gates the meta-row suppression.
  const todayRow = todayHoursRow(activity);
  // Nightlife's `Open tonight` meta chip is a different slot from the
  // generic status chip below — the mockup renders it *alongside* HoursRow,
  // never suppressed by `todayRow` the way the generic chip is.
  const metaChipStatus = nightlifeTonightChip(activity) ?? (status && !todayRow ? status : undefined);
  // Same usability gate as `todayRow` — defined exactly when the Hours
  // row's tap affordance below should be interactive.
  const weekData = weekHoursModalData(activity);
  const metaExtras = metaRowExtras(activity);
  const fields = factStripFields(activity);
  // design-spec.md's Stat grid degradation rule: 1 valid value folds into
  // the meta line rather than rendering a 1-cell grid — FactStrip below
  // independently reaches the identical "omit below 2" decision via the
  // same pure `classifyFactChips`, so there's no risk of the two disagreeing.
  const classifiedFactChips = classifyFactChips(fields);
  // ponytail: the fold keeps only `.value`, dropping `.label` — deliberate,
  // not an oversight (see the meta-line test asserting the label doesn't
  // survive). Every folded field observed so far reads fine unlabelled
  // (e.g. "Fast" for Wifi in the culture/shopping screens); revisit with a
  // `label` fold for a field where the bare value reads as context-free.
  const foldedFactChip = classifiedFactChips.length === 1 ? classifiedFactChips[0] : undefined;
  const foldedValue = foldedFactChip?.value;
  // design-spec.md's Kids composition: already-classified (see
  // `kidsAgeLabel`), so it's counted here as-is, same treatment as
  // `foldedFactChip.value` below.
  const kidsAge = kidsAgeLabel(activity);
  const unique = uniqueSection(activity);
  const goodToKnow = goodToKnowSection(activity);
  // design-spec.md's Tours & Experiences composition: three ordered
  // sub-sections share the single canonical 'unique' body slot (see
  // `renderBodySection`'s 'unique' case below) — `uniqueSection()` itself
  // has no tours_experiences case (stays undefined, the generic no-details
  // path), since a single `UniqueSectionData` can't hold three sections.
  const toursChecklist = toursIncludedChecklist(activity);
  const toursItineraryData = toursItinerary(activity);
  const meetingPointText = toursMeetingPoint(activity);
  const isDirectionsPrimary = primaryCTAIsDirections(activity.category);
  const genericLabel = genericActionLabel(activity.category);
  const websiteURL = getWebsiteURL(activity);
  const primaryEnabled = isDirectionsPrimary || Boolean(websiteURL);
  const attribution = artAttribution(activity);
  const bookingNote = wellnessBookingNote(activity);
  // Compliance: a Google-sourced reviews section (score, cards, attribution)
  // must always be able to link back to Google Maps, so it never renders
  // without `google_maps_uri` — no pending-state exception, since a
  // seed/cached payload can carry `google_reviews`/`rating` before the live
  // merge completes.
  const googleReviewsAllowed = Boolean(activity.google_maps_uri);
  // A Places-live row's aggregate score has exactly one home — the Reviews
  // slot below — once it actually renders a score header there (both
  // `rating` and `review_count` present); the title-block gold star is
  // this flag's sole consumer, suppressed only in that exact case so it
  // still carries the rating alone whenever the Reviews slot doesn't
  // (pending, a settled merge with no review count, or no
  // `google_maps_uri` yet, pending or settled, per the maps-link compliance
  // gate above).
  const reviewsScoreShown =
    isPlacesLive && googleReviewsAllowed && activity.rating > 0 && activity.review_count !== undefined;
  // tripadvisor-marks-require-reviews (T2) "rating trap": `activity.rating`
  // on a Tripadvisor-sourced row is Tripadvisor's own number until
  // `google_maps_uri` proves the live Places merge replaced it with
  // Google's — it must never render unattributed. Non-Tripadvisor rows are
  // unaffected (always allowed).
  const ratingAllowed = !isTripadvisorSourced(activity) || Boolean(activity.google_maps_uri);
  const showActualRating = ratingAllowed && activity.rating > 0;
  // Skeleton stands in exactly when there's no real value we're allowed to
  // show yet: the usual "seed has nothing yet" case (rule 1: never pulse
  // over an already-good value), plus a Tripadvisor row whose stale rating
  // isn't allowed to render until `ratingAllowed` above settles.
  const ratingSkeletonShown = isPlacesLive && detailsPending && !showActualRating;
  // The title-block rating cluster (star + number, or its loading skeleton)
  // is the only thing left in that row now that the category pill has
  // moved into MetaLine below (see `metaLineLeadItems`) — render the row
  // at all only when this cluster itself has something to show, so a
  // non-Tripadvisor row with a settled zero rating doesn't leave an empty
  // spacer box.
  const showRatingCluster = !reviewsScoreShown && (showActualRating || ratingSkeletonShown);
  // design-spec.md's Tripadvisor initiative: presence of this field is the
  // sole detection signal for the Tripadvisor-branded treatment below.
  const tripadvisor = tripadvisorAttribution(activity);
  const reviews = tripadvisorReviews(activity);
  const address = tripadvisorAddressLine(activity);
  // §5b: eyebrow line above the title — undefined (no render) for a
  // non-Tripadvisor row.
  const eyebrow = tripadvisorEyebrow(activity, metaText);
  // §5b: the eyebrow replaces the meta row's distance segment for a
  // Tripadvisor row (never both — same fact shown once). `metaExtras` is
  // structurally always [] here (only ever populated for `entertainment`,
  // which can never carry `tripadvisor` — see `tripadvisorAttribution`'s
  // switch), so the only thing the meta row can still uniquely carry for a
  // Tripadvisor row is the legacy free-text Open/Closed `status` (when
  // `opening_hours` isn't usable and the standalone HoursRow — gated by
  // `todayRow` — isn't already showing it). The whole row collapses when
  // even that isn't true, so no empty row/gap survives it.
  const showMetaRow = !tripadvisor || Boolean(status && !todayRow);
  // Whether the Places-live reviews card below renders at all this pass
  // (vs. its loading skeleton) — same condition as the JSX branch just
  // below. This flag's sole consumer is the reviews-card skeleton branch —
  // it decides skeleton-vs-attempt-content only ("is there genuinely
  // nothing populated yet"); it must NOT also gate whether content is
  // allowed to render — that's `googleReviewsAllowed`'s job alone, checked
  // separately in the JSX below, so a seed that already carries reviews
  // (this flag true) but no maps link (that flag false) renders neither
  // the skeleton (would be lying — content already exists) nor the section
  // (no link) — silence, not a premature plate.
  const googleReviewsCardShown =
    isPlacesLive && !(detailsPending && (activity.google_reviews ?? []).length === 0 && !activity.google_maps_uri);
  // Description skeleton must never show for a Tripadvisor-sourced row
  // (de-marked or not): `withTripadvisorGoogleReviews` (T1) never sets
  // `Description` on that merge path — only Rating/ReviewCount/
  // GoogleReviews/GoogleMapsURI — so an empty stored TA description (a real
  // case, TA sync can store one) would otherwise skeleton forever and never
  // resolve into content, the flash-then-collapse DESIGN_STANDARDS.md
  // forbids. Genuine Places-live categories are unaffected — their skeleton
  // still resolves once the merge lands.
  const descriptionPending = isPlacesLive && detailsPending && !seedTripadvisorSourced;

  return {
    activity,
    photos,
    heroIndex,
    setHeroIndex,
    detailsPending,
    isPlacesLive,
    metaText,
    status,
    levelChipText,
    todayRow,
    metaChipStatus,
    weekData,
    metaExtras,
    fields,
    foldedValue,
    kidsAge,
    unique,
    goodToKnow,
    toursChecklist,
    toursItineraryData,
    meetingPointText,
    isDirectionsPrimary,
    genericLabel,
    websiteURL,
    primaryEnabled,
    attribution,
    bookingNote,
    googleReviewsAllowed,
    reviewsScoreShown,
    showRatingCluster,
    ratingSkeletonShown,
    tripadvisor,
    reviews,
    address,
    eyebrow,
    showMetaRow,
    googleReviewsCardShown,
    descriptionPending,
  };
}
