import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AccessibilityInfo,
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { ArrowUpRight, Info, MapPin, MapPinOff, Star } from 'lucide-react-native';
import type { Activity, ActivityPhoto } from '../../api/activities';
import { getActivity, getActivityPhotos } from '../../api/activities';
import {
  hasMapsKey,
  hasValidCoordinates,
  staticMapUrl,
} from '../../api/staticMap';
import { ErrorBanner } from '../../components/ErrorBanner';
import { GoogleAttributionPlate } from '../../components/GoogleAttributionPlate';
import { PhotoAttributionCaption } from '../../components/PhotoAttributionCaption';
import { Skeleton } from '../../components/Skeleton';
import { useFocusable } from '../../hooks/useFocusable';
import {
  colors,
  fontFamily,
  fontSize,
  radius,
  space,
} from '../../theme/tokens';
import { classifyField } from './fieldKind';
import { ActionChips, type ActionChipItem } from './ActionChips';
import {
  artAttribution,
  bodySectionOrder,
  factStripFields,
  genericActionLabel,
  goodToKnowSection,
  kidsAgeLabel,
  metaDistanceText,
  metaLineLeadItems,
  metaRowExtras,
  nightlifeTonightChip,
  openStatus,
  priceContextLine,
  PRIMARY_CTA_LABEL,
  primaryActionURL,
  primaryCTAIsDirections,
  stripLeadingFrom,
  todayHoursRow,
  toursIncludedChecklist,
  toursItinerary,
  toursMeetingPoint,
  tripadvisorAddressLine,
  tripadvisorAttribution,
  tripadvisorEyebrow,
  tripadvisorReviews,
  uniqueSection,
  weekHoursModalData,
  wellnessBookingNote,
  type BodySection,
} from './activityDetailConfig';
import { DifficultyMeter } from './DifficultyMeter';
import {
  DescriptionSkeleton,
  PLACES_LIVE_CATEGORIES,
  RatingSkeleton,
  ReviewsSkeleton,
  UniqueSectionSkeleton,
} from './DetailSkeletons';
import { classifyFactChips, FactStrip } from './FactStrip';
import { HeroCarousel } from './HeroCarousel';
import { HoursRow } from './HoursRow';
import { MetaLine } from './MetaLine';
import { PhotoViewerModal } from './PhotoViewerModal';
import { ProseBlock } from './ProseBlock';
import { ReviewsSection } from './ReviewsSection';
import { TripadvisorBlock } from './TripadvisorBlock';
import { UniqueSection, sectionHeadingStyle } from './UniqueSection';
import { WeekHoursModal } from './WeekHoursModal';

// design-spec.md's T4 "Shared base layout" section: hero photo carousel
// (T2, owns the back control + top safe-area inset — see HeroCarousel),
// title/badge/rating, description, fact strip, unique section, bottom
// action bar. Pushed onto the existing hand-rolled stack by
// ActivityListScreen (see there) — no router. Renders from the
// already-loaded `Activity` immediately (no blocking loading/error/empty
// state), then fires the T4 photo-set upgrade fetch in the background — see
// the `photos` state below for that surface — and T6's live-details
// upgrade fetch (see the `activity` state below), which skeletons the
// Places-backed blocks (rating/fact-strip/description/unique-section/
// reviews) while pending and merges onto them on success. Other async
// surfaces here: hero/map images, CTA OS-handoff failures.
const DETAIL_MAP_WIDTH = 600;
const DETAIL_MAP_HEIGHT = 400; // 3:2, per the map box's reserved aspect ratio.
// design-spec.md's "Reviews" slot (§B10): "up to three cards" — the Google
// attribution plate itself renders every review it's given (no cap of its
// own, and it's compliance-critical so its internals stay untouched), so
// the cap is enforced at this call site instead.
const MAX_REVIEW_CARDS = 3;

type ActivityDetailScreenProps = {
  activity: Activity;
  showDistance: boolean;
  onBack: () => void;
};

// T6: true when a live merge genuinely put something new on screen — used
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

export function ActivityDetailScreen({
  activity: seedActivity,
  showDistance,
  onBack,
}: ActivityDetailScreenProps) {
  const genericFocus = useFocusable();
  const primaryFocus = useFocusable();
  const mapFocus = useFocusable();
  const tripadvisorLinkFocus = useFocusable();
  const insets = useSafeAreaInsets();
  const [mapState, setMapState] = useState<'loading' | 'loaded' | 'broken'>(
    'loading',
  );
  const [ctaBusy, setCtaBusy] = useState(false);
  const [ctaError, setCtaError] = useState<string | null>(null);
  // T2: null = closed; a number = open the fullscreen viewer at that page
  // (the hero carousel's current page — continuity between the two).
  // Fewer than 2 photos never opens this (the hero's pill hides itself).
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // opening-hours T2: the full-week modal, same conditional-mount pattern as
  // the photo viewer above.
  const [hoursModalOpen, setHoursModalOpen] = useState(false);
  // T4: starts as the provisional list data, upgrades in place once T3's
  // GET /activities/{id}/photos resolves. `image_refs[0]` is guaranteed to
  // stay the same photo pre/post-upgrade (T2 persists it first), so the
  // hero never swaps/reloads — only `photos.length` (the count pill) and
  // the viewer's slide count change. Failure/timeout leaves this untouched
  // — no error UI, per design-spec.md. ActivityListScreen only ever mounts
  // this screen fresh per open (`{selectedActivity && <ActivityDetailScreen
  // .../>}`), never swaps `activity` on an already-mounted instance, so
  // there's no reset-on-prop-change case to handle here.
  const [photos, setPhotos] = useState<ActivityPhoto[]>(seedActivity.image_refs);
  // bugfix: HeroCarousel pages through `photos` internally — this mirrors its
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

  // T6: seeds `activity` state from the passed prop (frame one, no waiting
  // — design-spec.md's "Progressive enrichment"), then merges the
  // Places-backed fields (rating/details/description/reviews/maps link)
  // onto it once getActivity(id) resolves. Every other field on `activity`
  // below (title/tags/location/category/etc.) is never reassigned, so it's
  // always identical to `seedActivity` — every existing read below that
  // used to read the `activity` prop now reads this state instead, which is
  // a strict upgrade over the seed, never a regression. Cancelled-effect
  // guard mirrors the photos effect above; failure/timeout is silently
  // dropped (design-spec.md: no error UI for content the user never saw).
  const [activity, setActivity] = useState<Activity>(seedActivity);
  // Cafés is the one category that can be either Tripadvisor- or
  // Google-sourced (#103/#104) — a Tripadvisor-sourced café must stay
  // Tripadvisor-treated only, same as a Tripadvisor restaurant/bar, so this
  // excludes any row `tripadvisorAttribution` already claims.
  const isPlacesLive =
    PLACES_LIVE_CATEGORIES.has(seedActivity.category) && !tripadvisorAttribution(seedActivity);
  // A Tripadvisor/admin row is never skeletoned and the merge can't improve
  // it (T2's own gate never live-merges these), so it starts (and stays)
  // settled — the effect below skips the round trip entirely for it,
  // rather than fetch-and-discard on every open.
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
          // Server-side merge already never blanks a good stored value
          // (T2) — this `||` is belt-and-suspenders against the same
          // mistake here.
          description: merged.description || prev.description,
          google_reviews: merged.google_reviews,
          google_maps_uri: merged.google_maps_uri,
          // T4 (activity-detail-system): ReviewsSection's score header needs
          // this alongside `rating` — dropped from the merge until now, so
          // the header silently never rendered for any Places-live venue
          // (`reviewCount` stayed the seed's `undefined` forever).
          review_count: merged.review_count,
        }));
        // Only announce "added" when the merge genuinely put something new
        // on screen — a merge that collapsed every block is nothing to
        // tell an AT user arrived.
        if (hasLiveContent(merged)) AccessibilityInfo.announceForAccessibility('Place details added');
      }
      setDetailsPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [seedActivity.id, isPlacesLive]);

  const heroPhoto = photos[heroIndex];
  const metaText = metaDistanceText(activity, showDistance);
  const status = openStatus(activity);
  // design-spec.md's Tours & Experiences composition (T10): "Tour ·
  // <subtype> · Meets <distance> away" + a level chip (never the
  // difficulty meter — that's Sport's, per T7's cross-check). Mutually
  // exclusive with the status chip below (Tours never has one — not in
  // `openingHoursOf`'s switch, no `open_status`/`open_tonight` fields).
  const levelChipText =
    activity.details?.category === 'tours_experiences'
      ? classifyField('scalar', activity.details.difficulty_level)
      : undefined;
  // opening-hours T1: when this is defined, it supersedes the meta row's
  // own Open/Closed item below (single home for the status, per
  // design-spec.md) — T4 moved the actual rendering of today's status/hours
  // into the standalone HoursRow (see below), this flag now only gates the
  // meta-row suppression.
  const todayRow = todayHoursRow(activity);
  // T7 round-2 fix: Nightlife's `Open tonight` meta chip is a different slot
  // from the generic status chip below — the mockup renders it *alongside*
  // HoursRow, never suppressed by `todayRow` the way the generic chip is.
  const metaChipStatus = nightlifeTonightChip(activity) ?? (status && !todayRow ? status : undefined);
  // opening-hours T2: same usability gate as `todayRow` — defined exactly
  // when the Hours row's tap affordance below should be interactive.
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
  // T11 (T9 round-3 follow-up): a price-shaped chip's `foldPrefix` (see
  // activityDetailConfig.ts's `FactChip` type) only applies once it's the
  // lone meta-line survivor — the grid render (FactStrip.tsx) never reads
  // it, since the chip's own label already carries the context there.
  // `stripLeadingFrom` avoids a doubled "from from €X" when the raw scraped
  // value already arrives pre-prefixed (same guard `priceContextLine`/the
  // Treatments density already apply to this identical field shape).
  const foldedValue = foldedFactChip
    ? foldedFactChip.foldPrefix
      ? `${foldedFactChip.foldPrefix}${stripLeadingFrom(foldedFactChip.value)}`
      : foldedFactChip.value
    : undefined;
  // design-spec.md T8's Kids composition: already-classified (see
  // `kidsAgeLabel`), so it's counted here as-is, same treatment as
  // `foldedFactChip.value` below.
  const kidsAge = kidsAgeLabel(activity);
  // T5 round-4 fix: round 3's guard counted *assumed* candidates (2 lead
  // items, always) instead of what MetaLine will actually render, so it
  // evicted `metaText` even when the real count never reached the 4-item
  // cap — e.g. empty/off-taxonomy `subcategory` (no subtype item) or a
  // >18-char neighborhood (`classifyField` drops it). Count the same items
  // MetaLine's `rawItems`/`items` will render (lead items raw, `metaExtras`
  // through the same `classifyField('scalar', …)` MetaLine's `items` prop
  // applies — `foldedFactChip.value` is already classifyField'd output via
  // `classifyFactChips`, so it's passed as-is) and only yield `metaText`'s
  // slot when that real count already fills the cap.
  const metaLineOverflow =
    [
      ...metaLineLeadItems(activity),
      kidsAge,
      ...metaExtras.map((v) => classifyField('scalar', v)),
      foldedFactChip?.value,
    ].filter(Boolean).length >= 4;
  const unique = uniqueSection(activity);
  const goodToKnow = goodToKnowSection(activity);
  // design-spec.md's Tours & Experiences composition (T10): three ordered
  // sub-sections share the single canonical 'unique' body slot (see
  // `renderBodySection`'s 'unique' case below) — `uniqueSection()` itself
  // has no tours_experiences case (stays undefined, the generic no-details
  // path), since a single `UniqueSectionData` can't hold three sections.
  const toursChecklist = toursIncludedChecklist(activity);
  const toursItineraryData = toursItinerary(activity);
  const meetingPointText = toursMeetingPoint(activity);
  const isDirectionsPrimary = primaryCTAIsDirections(activity.category);
  const genericLabel = genericActionLabel(activity.category);
  const actionURL = primaryActionURL(activity);
  const primaryEnabled = isDirectionsPrimary || Boolean(actionURL);
  const attribution = artAttribution(activity);
  const bookingNote = wellnessBookingNote(activity);
  const priceContext = priceContextLine(activity);
  // T11 round 2: compliance — a Google-sourced reviews section (score,
  // cards, attribution) must always be able to link back to Google Maps, so
  // it never renders without `google_maps_uri` present, full stop — no
  // pending-state exception, since a seed/cached payload can already carry
  // `google_reviews`/`rating` before the live merge completes (the
  // `detailsPending ||` escape hatch round 1 shipped assumed pending meant
  // "nothing to show yet", which doesn't hold in that shape — probe-
  // verified: plate+cards+score all rendered with no link). Only the
  // skeleton (gated separately by `googleReviewsCardShown` below, on
  // whether anything is genuinely populated yet — not on this flag) gets a
  // pending-state pass. Same silent-omission shape as the existing
  // fetch-failed/unavailable rule (APP_STANDARDS.md's Error handling
  // carve-out), applied to this one extra precondition.
  const googleReviewsAllowed = Boolean(activity.google_maps_uri);
  // T4 round-2 review finding: a Places-live row's aggregate score has
  // exactly one home — the Reviews slot below — once it actually renders a
  // score header there (both `rating` and `review_count` present); the
  // title-block gold star is this flag's sole consumer, suppressed only in
  // that exact case so it still carries the rating alone whenever the
  // Reviews slot doesn't (pending, a settled merge with no review count, or
  // — T11 — no `google_maps_uri` yet, pending or settled, per the maps-link
  // compliance gate above).
  const reviewsScoreShown =
    isPlacesLive && googleReviewsAllowed && activity.rating > 0 && activity.review_count !== undefined;
  // T5: the title-block rating cluster (star + number, or its loading
  // skeleton) is the only thing left in that row now that the category
  // pill has moved into MetaLine below (see `metaLineLeadItems`) — render
  // the row at all only when this cluster itself has something to show, so
  // a non-Tripadvisor row with a settled zero rating doesn't leave an empty
  // spacer box.
  const showRatingCluster =
    !reviewsScoreShown && (activity.rating > 0 || (isPlacesLive && detailsPending && activity.rating <= 0));
  // design-spec.md T8 (Tripadvisor initiative): presence of this field is
  // the sole detection signal for the Tripadvisor-branded treatment below.
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
  // T5 round-2 fix: whether the Places-live reviews card below renders at
  // all this pass (vs. its loading skeleton) — same condition as the JSX
  // branch just below. T5 round-2 also gated a footer `GoogleAttributionPlate`
  // on this (to avoid a duplicate "View on Google Maps" link once the
  // reviews card's own `detail`-variant plate renders it); round-3 review
  // found that gated branch was provably unreachable (its two preconditions
  // — pending and no `google_maps_uri` — mean the footer plate is always
  // called with no uri, which renders null on its own) and deleted it
  // rather than keep dead code around. This flag's sole remaining consumer
  // is the reviews-card skeleton branch below — it decides skeleton-vs-
  // attempt-content only ("is there genuinely nothing populated yet"); T11
  // round 2: it must NOT also gate whether content is allowed to render —
  // that's `googleReviewsAllowed`'s job alone, checked separately in the
  // JSX below, so a seed that already carries reviews (this flag true)
  // but no maps link (that flag false) renders neither the skeleton (would
  // be lying — content already exists) nor the section (no link) — silence,
  // not a premature plate.
  const googleReviewsCardShown =
    isPlacesLive && !(detailsPending && (activity.google_reviews ?? []).length === 0 && !activity.google_maps_uri);

  // OS handoff: opens the device's maps app on the activity's coordinates.
  // Surfaces the generic error banner (never a silent no-op) when the intent
  // can't be resolved — DESIGN_STANDARDS.md's Error banner recipe.
  async function openDirections() {
    if (!hasValidCoordinates(activity.location)) {
      setCtaError('This activity has no location to get directions to.');
      return;
    }
    setCtaBusy(true);
    const url = `https://www.google.com/maps/dir/?api=1&destination=${activity.location.lat},${activity.location.lng}`;
    try {
      await Linking.openURL(url);
    } catch {
      setCtaError('Could not open maps. Please try again.');
    } finally {
      setCtaBusy(false);
    }
  }

  async function openShare() {
    setCtaBusy(true);
    try {
      await Share.share({
        message: `${activity.title} — ${activity.description}`,
      });
    } catch {
      setCtaError('Could not open the share sheet. Please try again.');
    } finally {
      setCtaBusy(false);
    }
  }

  function handleGenericPress() {
    return genericLabel === 'Directions' ? openDirections() : openShare();
  }

  // design-spec.md T8 addendum #1: the 8 non-directions categories' primary
  // CTA opens their external `action_url` (T7) via the same async/error
  // pattern as openDirections above.
  async function openExternalLink(url: string) {
    setCtaBusy(true);
    try {
      await Linking.openURL(url);
    } catch {
      setCtaError('Could not open the link. Please try again.');
    } finally {
      setCtaBusy(false);
    }
  }

  function handlePrimaryPress() {
    if (isDirectionsPrimary) return openDirections();
    if (actionURL) return openExternalLink(actionURL);
  }

  // design-spec.md T4's Place-facts list: "Phone... rendered as a tel: link
  // (tap to call)". Reuses `openExternalLink`'s existing async/error-banner
  // handling — a `tel:` URL fails the same way any other OS handoff can
  // (e.g. simulator has no phone app), and it should surface the same
  // generic error banner rather than a silent no-op.
  function handleCallPhone(phone: string) {
    return openExternalLink(`tel:${phone}`);
  }

  // design-spec.md's "Map + address" slot (§B11): existing, unchanged —
  // extracted to a function only so Tours' "Meeting point" section (below)
  // can render the same box in its own position instead of the generic
  // bottom spot (design-import mockup: "Tours replaces this with its own
  // Meeting point map"). Every other category still calls this once, at the
  // same bottom position it always has.
  function renderMapBox(): ReactNode {
    if (!hasMapsKey()) return null;
    return (
      <Pressable
        onPress={openDirections}
        onFocus={mapFocus.onFocus}
        onBlur={mapFocus.onBlur}
        disabled={!hasValidCoordinates(activity.location) || ctaBusy}
        accessibilityRole="button"
        accessibilityLabel="Open in Google Maps"
        style={[styles.mapBox, mapFocus.focused && styles.mapBoxFocused]}
      >
        {hasValidCoordinates(activity.location) && mapState !== 'broken' ? (
          <>
            <Image
              testID="activity-detail-map-image"
              source={{
                uri: staticMapUrl(activity.location, DETAIL_MAP_WIDTH, DETAIL_MAP_HEIGHT),
              }}
              style={styles.image}
              contentFit="cover"
              cachePolicy="memory-disk"
              accessibilityIgnoresInvertColors
              onLoad={() => setMapState('loaded')}
              onError={() => setMapState('broken')}
            />
            {mapState === 'loading' && (
              <Skeleton width="100%" height="100%" style={styles.imageSkeleton} />
            )}
          </>
        ) : (
          <View style={styles.imageFallback}>
            <MapPinOff size={20} color={colors.textMuted} strokeWidth={1.75} />
          </View>
        )}
      </Pressable>
    );
  }

  // design-spec.md T8 addendum #3: per-category body-section order.
  // FactStrip/UniqueSection/DifficultyMeter each already render nothing
  // when their own data is absent, so this only controls order, not
  // per-section omission.
  function renderBodySection(section: BodySection): ReactNode {
    switch (section) {
      case 'description':
        // T6 rule 1: only skeleton when the seed description is genuinely
        // empty — never pulse over text the user could already be reading.
        // design-spec.md's "Prose block" slot (§B5): the one legal home for
        // a generated sentence — replaces this screen's old inline `<Text>`
        // description render.
        if (activity.description) {
          return <ProseBlock key="description" heading="About" value={activity.description} />;
        }
        return isPlacesLive && detailsPending ? (
          <DescriptionSkeleton key="description" />
        ) : null;
      case 'difficulty':
        return activity.details?.category === 'sport' &&
          activity.details.difficulty !== undefined ? (
          <DifficultyMeter
            key="difficulty"
            difficulty={activity.details.difficulty}
            inferred={activity.details.difficulty_inferred}
          />
        ) : null;
      case 'factstrip':
        return <FactStrip key="factstrip" fields={fields} />;
      case 'unique':
        // design-spec.md's Tours & Experiences composition (T10): "What's
        // included" → "Meeting point" → "Itinerary", three sections sharing
        // this one canonical slot — see `toursChecklist`/`meetingPointText`/
        // `toursItineraryData` above. Every other category keeps the plain
        // single-`UniqueSection` render below, unchanged.
        if (activity.details?.category === 'tours_experiences') {
          if (!toursChecklist && !meetingPointText && !toursItineraryData) return null;
          return (
            <View key="unique" style={styles.toursUniqueGroup}>
              {toursChecklist && <UniqueSection data={toursChecklist} />}
              {meetingPointText && (
                <View style={styles.toursMeetingPoint}>
                  <Text style={sectionHeadingStyle}>Meeting point</Text>
                  {renderMapBox()}
                  <View style={styles.toursMeetingPointAddressRow}>
                    <MapPin size={15} color={colors.textMuted} strokeWidth={1.75} />
                    <Text style={styles.toursMeetingPointAddressText}>{meetingPointText}</Text>
                  </View>
                </View>
              )}
              {toursItineraryData && <UniqueSection data={toursItineraryData} />}
            </View>
          );
        }
        return isPlacesLive && detailsPending && !unique ? (
          <UniqueSectionSkeleton key="unique" category={activity.category} />
        ) : (
          <UniqueSection key="unique" data={unique} />
        );
      case 'goodtoknow':
        return goodToKnow ? <UniqueSection key="goodtoknow" data={goodToKnow} /> : null;
    }
  }

  // T11: design-spec.md's "Action chips" slot (§B2) — a fixed slot in the
  // canonical order for every category (T5), right after the title block,
  // not a per-category opt-in. Sourced entirely from fields the bottom
  // bar/generic actions already use above (`openDirections`/`actionURL`/
  // `openShare`/`handleCallPhone`) — no new backend data — each chip
  // individually omitting when its own data is absent, per `ActionChips`'
  // own contract. "Menu" has no backing field on any category today, so it
  // never renders (correct absence, not a gap).
  const tripadvisorPhone = tripadvisor?.phone;
  const actionChipItems: ActionChipItem[] = (
    [
      hasValidCoordinates(activity.location)
        ? { kind: 'directions', onPress: openDirections }
        : undefined,
      // Tripadvisor's own `web_url` already has a dedicated "Read all
      // reviews on Tripadvisor" footer CTA below — a Website chip pointing
      // at that same Tripadvisor page would mislabel it, so this only ever
      // sources a venue's own external link (the 8 non-directions
      // categories' shared `action_url`), never `tripadvisor.web_url`.
      actionURL ? { kind: 'website', onPress: () => openExternalLink(actionURL) } : undefined,
      tripadvisorPhone ? { kind: 'call', onPress: () => handleCallPhone(tripadvisorPhone) } : undefined,
      { kind: 'share', onPress: openShare },
    ] as (ActionChipItem | undefined)[]
  ).filter((item): item is ActionChipItem => item !== undefined);

  return (
    // T2: the hero owns the top safe-area inset (its overlaid back control
    // pads by insets.top itself) — no header bar above it, per
    // DESIGN_STANDARDS.md's Detail hero recipe / Mobile-specific over-hero
    // back-control variant. The footer below still owns the bottom inset.
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <HeroCarousel
          photos={photos}
          onBack={onBack}
          onOpenViewer={setViewerIndex}
          onIndexChange={setHeroIndex}
        />

        <PhotoAttributionCaption
          attribution={heroPhoto?.attribution}
          horizontalInset={space[6]}
        />

        <View style={styles.titleBlock}>
          {/* §5b: the gold-star rating is suppressed for a Tripadvisor row —
              the TripadvisorBlock below carries rating instead (compliance
              rule 03). `attribution` (art's artist/work/medium line) never
              co-occurs with `tripadvisor` (art can't be a Tripadvisor
              category), so the whole group is safely omitted rather than
              left as an empty View + phantom gap. T5: the old category ·
              qualifier badge pill (`badgeLabel`/`badgeQualifier`) is
              retired — category noun + subtype now lead the meta line below
              instead (see `metaLineLeadItems`), so this cluster is
              rating-only. */}
          {(attribution || (!tripadvisor && showRatingCluster)) && (
            <View style={styles.badgeGroup}>
              {attribution && (
                <Text style={styles.attributionLine}>
                  {[
                    attribution.artist && <Text key="artist">{attribution.artist}</Text>,
                    attribution.workYear && (
                      <Text key="workYear" style={styles.attributionItalic}>
                        {attribution.workYear}
                      </Text>
                    ),
                    attribution.medium && <Text key="medium">{attribution.medium}</Text>,
                  ]
                    .filter(Boolean)
                    .flatMap((node, i) => (i === 0 ? [node] : [' · ', node]))}
                </Text>
              )}

              {/* T6: "Rating value" — skeletoned only while the live fetch
                  is pending and the seed genuinely has nothing yet (rule 1:
                  never pulse over an already-good value); once settled with
                  no rating (failed/empty merge), the whole block collapses
                  (rule 3: no fabricated "0.0", no empty frame) rather than
                  falling back to a pre-T6-style zero. T4 round-2: once the
                  Reviews slot below is genuinely showing this same score
                  (`reviewsScoreShown`), this cluster stays hidden — one
                  focal rating number, not two (folded into
                  `showRatingCluster` above). */}
              {!tripadvisor && showRatingCluster && (
                isPlacesLive && detailsPending && activity.rating <= 0 ? (
                  <View style={styles.rating}>
                    <RatingSkeleton />
                  </View>
                ) : (
                  <View style={styles.rating}>
                    <Star
                      size={16}
                      color={colors.primary}
                      strokeWidth={1.75}
                      fill={colors.primary}
                    />
                    <Text style={styles.ratingLabel}>
                      {activity.rating.toFixed(1)}
                    </Text>
                  </View>
                )
              )}
            </View>
          )}

          <View style={styles.titleGroup}>
            {eyebrow && <Text style={styles.tripadvisorEyebrow}>{eyebrow}</Text>}
            <Text style={styles.title}>{activity.title}</Text>
            {/* Same shared-wire-object scoping as `tripadvisorEyebrow`'s
                price level: only Restaurants' composition names a cuisine
                subtitle (it's the stand-in for the Cuisine chip
                `factStripFields` drops on Tripadvisor rows). Bars/Cafés
                compositions don't mention it, even though the wire type
                carries `cuisine` for every Tripadvisor-sourced category. */}
            {activity.category === 'restaurants' && tripadvisor?.cuisine && (
              <Text style={styles.tripadvisorCuisineSubtitle}>{tripadvisor.cuisine}</Text>
            )}
          </View>

          {/* design-spec.md's "Meta line" slot (§B1): join-never-prefix,
              one optional status/level chip. T5: category noun + subtype
              (from the taxonomy-validated `subcategory` slug, never a
              generated field) now lead the line via `metaLineLeadItems` —
              retires `badgeQualifier`'s 9-branch switch and the separate
              badge pill above the title; absent for a Tripadvisor row
              (the eyebrow already carries category, per §5b). */}
          {showMetaRow && (
            <MetaLine
              // T5: category noun + subtype (from `subcategory`) lead,
              // ahead of distance/country — all app-computed/taxonomy data,
              // never run through `classifyField` (see MetaLine's
              // `rawItems`). Absent entirely for a Tripadvisor row (its
              // eyebrow above the title already carries category). T5
              // round-3 fix: `metaText` drops out of the lead items (rather
              // than the fold or neighborhood silently losing theirs — see
              // `metaLineOverflow`) on the one Entertainment collision where
              // all 5 candidates compete for 4 slots. T11 round 2:
              // `foldedValue` also belongs here, not in `items` below — it's
              // already been through `classifyField` once (via
              // `classifyFactChips`, on its unprefixed value) before the
              // `foldPrefix` was added, so running it through `items`'s
              // second `classifyField` call would measure the *prefixed*
              // string against the scalar cap and drop legitimate longer
              // prices outright (e.g. "€1200 per person" fine unprefixed,
              // "from €1200 per person" over the char cap) — `rawItems` is
              // exactly the already-final bypass this needs.
              rawItems={[
                ...(!tripadvisor
                  ? [...metaLineLeadItems(activity), kidsAge, metaLineOverflow ? undefined : metaText]
                  : []),
                foldedValue,
              ]}
              items={metaExtras}
              // T7 round-2 fix: Nightlife's `Open tonight` chip (folded into
              // `metaChipStatus` above) takes priority over, and unlike, the
              // generic status chip is never suppressed by `todayRow` — the
              // mockup shows the chip and HoursRow together, not one
              // replacing the other. Falls through to T10's Tours-only
              // `levelChipText` — the two are mutually exclusive (Tours
              // never has a status/open-tonight chip, see `levelChipText`'s
              // definition above).
              chip={
                metaChipStatus
                  ? { kind: 'status', text: metaChipStatus.text, isOpen: metaChipStatus.isOpen }
                  : levelChipText
                    ? { kind: 'level', text: levelChipText }
                    : undefined
              }
            />
          )}

          {/* design-spec.md's "Action chips" slot (§B2): fixed slot in the
              canonical order, right after the meta line — see
              `actionChipItems` above. */}
          <ActionChips items={actionChipItems} />

          {/* design-spec.md's "Hours row" slot (§B3): relocated out of the
              stat grid entirely into its own tappable disclosure row —
              present only when structured opening_hours is usable (same
              `todayHoursRow` gate the screen already had). Canonical order
              (T5): hero → title block → action chips → hours row → stat
              grid → ... */}
          <HoursRow data={todayRow} onPress={() => setHoursModalOpen(true)} />

          {bodySectionOrder(activity.category).map(renderBodySection)}

          {activity.tags.length > 0 ? (
            <View style={styles.tagsRow}>
              {activity.tags.map((tag) => (
                <View key={tag} style={styles.tagPill}>
                  <Text style={styles.tagLabel}>{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* design-spec.md's "Reviews" slot (§B10): one shared wrapper
              replacing this screen's old mutually-exclusive
              TripadvisorBlock-vs-GoogleAttributionPlate top-level branch.
              Neither compliance-critical attribution plate is touched —
              this only owns the outer score/distribution/"See all" layout
              around them. T5: moved from right after the meta row down to
              its canonical spot (after good-to-know, before the map),
              matching "... → good-to-know → reviews → map → bottom bar". */}
          {tripadvisor && (
            <ReviewsSection
              attribution={
                <TripadvisorBlock
                  tripadvisor={tripadvisor}
                  rating={activity.rating}
                  reviews={reviews}
                  address={address}
                  ctaBusy={ctaBusy}
                  onCallPhone={handleCallPhone}
                />
              }
            />
          )}

          {/* T6: the Places-case analogue of the TripadvisorBlock spot
              above — mutually exclusive with it (a Tripadvisor row is
              never `isPlacesLive`). Skeletoned only while pending and
              genuinely empty; GoogleAttributionPlate renders nothing on
              its own once merged with no reviews/maps link (silent
              degrade, no error UI). No generic score/distribution header for
              the Tripadvisor case above — compliance rule 03 forbids a
              second, Roamly-drawn aggregate rating beside Tripadvisor's own
              attribution plate. T11 round 2: `googleReviewsAllowed` gates
              only the content branch, not the skeleton — a pending row that
              already has reviews (content genuinely exists) but no maps
              link falls through to neither branch, per the compliance
              comment on that flag above. */}
          {isPlacesLive &&
            (!googleReviewsCardShown ? (
              <ReviewsSkeleton />
            ) : (
              googleReviewsAllowed && (
                <ReviewsSection
                  score={activity.rating > 0 ? activity.rating : undefined}
                  reviewCount={activity.review_count}
                  attribution={
                    <GoogleAttributionPlate
                      variant="detail"
                      reviews={activity.google_reviews?.slice(0, MAX_REVIEW_CARDS)}
                      googleMapsUri={activity.google_maps_uri}
                    />
                  }
                />
              )
            ))}

          {/* design-spec.md's "Map + address" slot (§B11): skipped here only
              when Tours' own "Meeting point" section (above, in the 'unique'
              body slot) is already rendering this same box — every other
              category (and Tours' own no-details/no-meeting_point states)
              renders it at this, its usual bottom position. */}
          {!(activity.details?.category === 'tours_experiences' && meetingPointText) &&
            renderMapBox()}

          {/* design-spec.md T4's Footer CTAs + disclaimer section: the
              deep-link button + disclaimer are the trailing elements of the
              scrollable content — after facts/map, right before the pinned
              Directions/Book-a-table footer bar. ("Add to my trip" is
              out of scope — no existing trip/itinerary action to wire it
              to, per T4's feature-availability escalation.) */}
          {tripadvisor && (
            <View style={styles.tripadvisorFooterCta}>
              <Pressable
                onPress={() => openExternalLink(tripadvisor.web_url)}
                onFocus={tripadvisorLinkFocus.onFocus}
                onBlur={tripadvisorLinkFocus.onBlur}
                disabled={ctaBusy}
                accessibilityRole="button"
                accessibilityLabel="Read all reviews on Tripadvisor"
                style={[
                  styles.tripadvisorLinkButton,
                  tripadvisorLinkFocus.focused &&
                    styles.tripadvisorLinkButtonFocused,
                ]}
              >
                <Text style={styles.tripadvisorLinkLabel}>
                  Read all reviews on Tripadvisor
                </Text>
                <ArrowUpRight size={16} color={colors.ink} strokeWidth={1.75} />
              </Pressable>

              <Text style={styles.tripadvisorDisclaimer}>
                Ratings, reviews and photos for restaurants, bars and cafés are sourced from Tripadvisor and
                refreshed periodically. Roamly does not rate these places.
              </Text>
            </View>
          )}

        </View>
      </ScrollView>

      {ctaError && (
        <ErrorBanner message={ctaError} onDismiss={() => setCtaError(null)} />
      )}

      <View
        testID="activity-detail-footer"
        style={[styles.footer, { paddingBottom: space[6] + insets.bottom }]}
      >
        {bookingNote && (
          <View style={styles.bookingNote}>
            <Info size={16} color={colors.textMuted} strokeWidth={1.75} />
            <Text style={styles.bookingNoteText}>{bookingNote}</Text>
          </View>
        )}
        {/* design-spec.md's "Bottom bar" slot (§B12): optional
            price-context line above the button row — omits only this line
            when the category's price_from is absent/invalid. */}
        {priceContext && <Text style={styles.priceContextText}>{priceContext}</Text>}
        <View style={styles.footerButtons}>
        <Pressable
          onPress={handleGenericPress}
          onFocus={genericFocus.onFocus}
          onBlur={genericFocus.onBlur}
          disabled={ctaBusy}
          accessibilityRole="button"
          accessibilityLabel={genericLabel}
          style={[
            styles.secondaryButton,
            genericFocus.focused && styles.secondaryButtonFocused,
          ]}
        >
          <Text style={styles.secondaryLabel}>{genericLabel}</Text>
        </Pressable>
        <Pressable
          onPress={handlePrimaryPress}
          onFocus={primaryFocus.onFocus}
          onBlur={primaryFocus.onBlur}
          disabled={!primaryEnabled || ctaBusy}
          accessibilityRole="button"
          accessibilityLabel={PRIMARY_CTA_LABEL[activity.category]}
          accessibilityState={{ disabled: !primaryEnabled }}
          style={[
            styles.primaryButton,
            !primaryEnabled && styles.primaryButtonDisabled,
            primaryEnabled &&
              primaryFocus.focused &&
              styles.primaryButtonFocused,
          ]}
        >
          <Text
            style={[
              styles.primaryLabel,
              !primaryEnabled && styles.primaryLabelDisabled,
            ]}
          >
            {PRIMARY_CTA_LABEL[activity.category]}
          </Text>
        </Pressable>
        </View>
      </View>

      {viewerIndex !== null && (
        <PhotoViewerModal
          photos={photos}
          activityTitle={activity.title}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}

      {hoursModalOpen && weekData && (
        <WeekHoursModal data={weekData} onClose={() => setHoursModalOpen(false)} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  body: {
    paddingBottom: space[8],
  },
  mapBox: {
    width: '100%',
    aspectRatio: 3 / 2,
    borderRadius: radius.default,
    overflow: 'hidden',
    backgroundColor: colors.surfaceHover,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  mapBoxFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageSkeleton: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  titleBlock: {
    paddingHorizontal: space[6],
    paddingTop: space[6],
    gap: space[6],
  },
  badgeGroup: {
    gap: space[3],
  },
  attributionLine: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    letterSpacing: 0.24,
  },
  attributionItalic: {
    fontStyle: 'italic',
  },
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  ratingLabel: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  // §5b: wraps eyebrow/title/cuisine-subtitle as one tight cluster — a
  // smaller gap than titleBlock's own space[6] between its top-level
  // sections, matching the mock's close eyebrow→h2→subtitle spacing.
  titleGroup: {
    gap: space[1],
  },
  // §5b: eyebrow (category · price level · distance) — same overline
  // treatment as TripadvisorReviewsCarousel's section label.
  tripadvisorEyebrow: {
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: fontSize.xs * 0.08,
    color: colors.primary,
  },
  tripadvisorCuisineSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: fontSize.sm * 1.5,
  },
  title: {
    // Marcellus loads once, globally, gated by ScopePickerScreen at the
    // start of the nav stack — every screen after it (this one included)
    // applies the token directly, same as the activities-list/search-setup
    // H1s (see tokens.ts's fontFamily.display comment).
    fontFamily: fontFamily.display,
    fontSize: fontSize.xl,
    color: colors.text,
    fontWeight: '400',
    lineHeight: fontSize.xl * 1.1,
  },
  tripadvisorFooterCta: {
    gap: space[4],
  },
  tripadvisorLinkButton: {
    // design-spec.md's updated 5b footer: sole footer CTA, filled Primary
    // (DESIGN_STANDARDS.md's Buttons table) — was Secondary/outlined.
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    minHeight: 54,
    borderRadius: radius.default,
    backgroundColor: colors.primary,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  tripadvisorLinkButtonFocused: {
    backgroundColor: colors.primaryHover,
  },
  tripadvisorLinkLabel: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
  },
  tripadvisorDisclaimer: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: fontSize.xs * 1.55,
  },
  // Tours & Experiences' three-part 'unique' body slot (T10) — same
  // top-level rhythm as the other body sections' own space[6] gap.
  toursUniqueGroup: {
    gap: space[6],
  },
  toursMeetingPoint: {
    gap: space[3],
  },
  toursMeetingPointAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  toursMeetingPointAddressText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  tagPill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingVertical: space[1],
    paddingHorizontal: space[2],
  },
  tagLabel: {
    fontSize: fontSize.xs,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  footer: {
    paddingHorizontal: space[6],
    paddingTop: space[4],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  bookingNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginBottom: space[3],
  },
  bookingNoteText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  // .dc.html's bottom-bar price line: 15px/600 cream — rounds up to the
  // nearest token per DESIGN_STANDARDS.md's Typography rounding convention
  // (body text floor is --font-size-sm/14px; 15px rounds up to --font-size-md/16px).
  priceContextText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
    marginBottom: space[3],
  },
  footerButtons: {
    flexDirection: 'row',
    gap: space[3],
  },
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.default,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  secondaryButtonFocused: {
    backgroundColor: colors.surfaceHover,
    borderColor: colors.primary,
  },
  secondaryLabel: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  primaryButton: {
    flex: 1.3,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.default,
    backgroundColor: colors.primary,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  primaryButtonFocused: {
    backgroundColor: colors.primaryHover,
  },
  // AC: disabled CTA is `--text-disabled` on a flat `--surface` fill —
  // `--surface-hover` was a raised/interactive fill, wrong for a non-
  // interactive disabled state.
  primaryButtonDisabled: {
    backgroundColor: colors.surface,
  },
  primaryLabel: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.ink,
  },
  primaryLabelDisabled: {
    color: colors.textDisabled,
  },
});
