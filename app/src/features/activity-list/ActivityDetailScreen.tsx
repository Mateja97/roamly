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
import {
  artAttribution,
  badgeLabel,
  BODY_SECTION_ORDER,
  factStripFields,
  genericActionLabel,
  metaRowExtras,
  openStatus,
  PRIMARY_CTA_LABEL,
  primaryActionURL,
  primaryCTAIsDirections,
  todayHoursRow,
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
  FactStripSkeleton,
  factStripSkeletonCount,
  PLACES_LIVE_CATEGORIES,
  RatingSkeleton,
  ReviewsSkeleton,
  UniqueSectionSkeleton,
} from './DetailSkeletons';
import { FactStrip } from './FactStrip';
import { HeroCarousel } from './HeroCarousel';
import { PhotoViewerModal } from './PhotoViewerModal';
import { TripadvisorBlock } from './TripadvisorBlock';
import { UniqueSection } from './UniqueSection';
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

type ActivityDetailScreenProps = {
  activity: Activity;
  showDistance: boolean;
  onBack: () => void;
};

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
  const [detailsPending, setDetailsPending] = useState(true);
  const isPlacesLive = PLACES_LIVE_CATEGORIES.has(seedActivity.category);
  useEffect(() => {
    let cancelled = false;
    // design-spec.md's Accessibility notes: one polite loading status for
    // the whole enriching region, only for a category the fetch can
    // actually change anything on-screen for.
    if (isPlacesLive) AccessibilityInfo.announceForAccessibility('Loading place details');
    getActivity(seedActivity.id).then((result) => {
      if (cancelled) return;
      if (result.status === 'success') {
        setActivity((prev) => ({
          ...prev,
          rating: result.activity.rating,
          details: result.activity.details,
          // Server-side merge already never blanks a good stored value
          // (T2) — this `||` is belt-and-suspenders against the same
          // mistake here.
          description: result.activity.description || prev.description,
          google_reviews: result.activity.google_reviews,
          google_maps_uri: result.activity.google_maps_uri,
        }));
        if (isPlacesLive) AccessibilityInfo.announceForAccessibility('Place details added');
      }
      setDetailsPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [seedActivity.id, isPlacesLive]);

  const heroPhoto = photos[heroIndex];
  const metaText = showDistance
    ? `${activity.distance_km.toFixed(1)} km away`
    : activity.country;
  const status = openStatus(activity);
  // opening-hours T1: when this is defined, it supersedes the meta row's
  // own Open/Closed item below (single home for the status, per
  // design-spec.md) — opening-hours T3 moved the actual rendering of
  // today's status/hours into the FactStrip Hours chip (see `fields`
  // below), this flag now only gates the meta-row suppression.
  const todayRow = todayHoursRow(activity);
  // opening-hours T2: same usability gate as `todayRow` — defined exactly
  // when the Hours chip's tap affordance below should be interactive.
  const weekData = weekHoursModalData(activity);
  const metaExtras = metaRowExtras(activity);
  // opening-hours T3: threads the modal-open callback into the Hours chip —
  // `factStripFields` only attaches it when structured opening_hours is
  // usable (see `hoursChip` there), so this is a no-op for the legacy chip.
  const fields = factStripFields(activity, () => setHoursModalOpen(true));
  const unique = uniqueSection(activity);
  const isDirectionsPrimary = primaryCTAIsDirections(activity.category);
  const genericLabel = genericActionLabel(activity.category);
  const actionURL = primaryActionURL(activity);
  const primaryEnabled = isDirectionsPrimary || Boolean(actionURL);
  const attribution = artAttribution(activity);
  const bookingNote = wellnessBookingNote(activity);
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
  // `opening_hours` isn't usable and the FactStrip's Hours chip — gated by
  // `todayRow` — isn't already showing it). The whole row collapses when
  // even that isn't true, so no empty row/gap survives it.
  const showMetaRow = !tripadvisor || Boolean(status && !todayRow);

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

  // design-spec.md T8 addendum #3: per-category body-section order.
  // FactStrip/UniqueSection/DifficultyMeter each already render nothing
  // when their own data is absent, so this only controls order, not
  // per-section omission.
  function renderBodySection(section: BodySection): ReactNode {
    switch (section) {
      case 'description':
        // T6 rule 1: only skeleton when the seed description is genuinely
        // empty — never pulse over text the user could already be reading.
        if (activity.description) {
          return (
            <Text key="description" style={styles.description}>
              {activity.description}
            </Text>
          );
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
          />
        ) : null;
      case 'factstrip':
        return isPlacesLive && detailsPending && fields.length === 0 ? (
          <FactStripSkeleton key="factstrip" count={factStripSkeletonCount(activity.category)} />
        ) : (
          <FactStrip key="factstrip" fields={fields} />
        );
      case 'unique':
        return isPlacesLive && detailsPending && !unique ? (
          <UniqueSectionSkeleton key="unique" category={activity.category} />
        ) : (
          <UniqueSection key="unique" data={unique} />
        );
    }
  }

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
          {/* §5b: the badge pill (category · qualifier) and the gold-star
              rating are both suppressed for a Tripadvisor row — the eyebrow
              carries category, the TripadvisorBlock below carries rating
              (compliance rule 03). `attribution` (art's artist/work/medium
              line) never co-occurs with `tripadvisor` (art can't be a
              Tripadvisor category), so the whole group is safely omitted
              rather than left as an empty View + phantom gap. */}
          {(attribution || !tripadvisor) && (
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

              {!tripadvisor && (
                <View style={styles.row}>
                  <View style={styles.badge}>
                    <Text style={styles.badgeLabel}>{badgeLabel(activity)}</Text>
                  </View>
                  <View style={styles.rating}>
                    {/* T6: "Rating value" placeholder — only while the live
                        fetch is pending and the seed genuinely has nothing
                        yet (rule 1: never pulse over an already-good value). */}
                    {isPlacesLive && detailsPending && activity.rating <= 0 ? (
                      <RatingSkeleton />
                    ) : (
                      <>
                        <Star
                          size={16}
                          color={colors.primary}
                          strokeWidth={1.75}
                          fill={colors.primary}
                        />
                        <Text style={styles.ratingLabel}>
                          {activity.rating.toFixed(1)}
                        </Text>
                      </>
                    )}
                  </View>
                </View>
              )}
            </View>
          )}

          <View style={styles.titleGroup}>
            {eyebrow && <Text style={styles.tripadvisorEyebrow}>{eyebrow}</Text>}
            <Text style={styles.title}>{activity.title}</Text>
            {tripadvisor?.cuisine && (
              <Text style={styles.tripadvisorCuisineSubtitle}>{tripadvisor.cuisine}</Text>
            )}
          </View>

          {showMetaRow && (
            <View style={styles.metaRow}>
              {activity.category === 'nightlife' && status && !todayRow ? (
                // design-spec.md T8 addendum #9: the status dot + label is the
                // only place a leading status dot appears, and sits first,
                // before the usual "·"-separated items. (Nightlife can never
                // carry `tripadvisor` — see `tripadvisorAttribution`'s
                // switch — so this branch is unaffected by the §5b change.)
                <>
                  <View style={styles.statusGroup}>
                    {status.isOpen && (
                      <View
                        style={styles.statusDot}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                      />
                    )}
                    <Text
                      style={
                        status.isOpen ? styles.statusOpen : styles.statusClosed
                      }
                    >
                      {status.text}
                    </Text>
                  </View>
                  <Text style={styles.metaSeparator}>·</Text>
                  <MapPin size={16} color={colors.textMuted} strokeWidth={1.75} />
                  <Text style={styles.metaText}>{metaText}</Text>
                </>
              ) : (
                <>
                  {/* §5b: distance is now the eyebrow's trailing segment for
                      a Tripadvisor row — never shown here too. */}
                  {!tripadvisor && (
                    <>
                      <MapPin size={16} color={colors.textMuted} strokeWidth={1.75} />
                      <Text style={styles.metaText}>{metaText}</Text>
                    </>
                  )}
                  {metaExtras.map((extra) => (
                    <View key={extra} style={styles.metaExtraGroup}>
                      <Text style={styles.metaSeparator}>·</Text>
                      <Text style={styles.metaText}>{extra}</Text>
                    </View>
                  ))}
                  {status && !todayRow && (
                    <View style={styles.metaExtraGroup}>
                      {/* No leading "·" when this is the row's only content
                          (the Tripadvisor case — distance/metaExtras both
                          suppressed/empty above). */}
                      {!tripadvisor && <Text style={styles.metaSeparator}>·</Text>}
                      <Text
                        style={
                          status.isOpen
                            ? styles.statusOpen
                            : styles.statusClosed
                        }
                      >
                        {status.text}
                      </Text>
                    </View>
                  )}
                </>
              )}
            </View>
          )}

          {tripadvisor && (
            <TripadvisorBlock
              tripadvisor={tripadvisor}
              rating={activity.rating}
              reviews={reviews}
              address={address}
              ctaBusy={ctaBusy}
              onCallPhone={handleCallPhone}
            />
          )}

          {/* T6: the Places-case analogue of the TripadvisorBlock spot
              above — mutually exclusive with it (a Tripadvisor row is
              never `isPlacesLive`). Skeletoned only while pending and
              genuinely empty; GoogleAttributionPlate renders nothing on
              its own once merged with no reviews/maps link (silent
              degrade, no error UI). */}
          {isPlacesLive &&
            (detailsPending && (activity.google_reviews ?? []).length === 0 && !activity.google_maps_uri ? (
              <ReviewsSkeleton />
            ) : (
              <GoogleAttributionPlate
                variant="detail"
                reviews={activity.google_reviews}
                googleMapsUri={activity.google_maps_uri}
              />
            ))}

          {BODY_SECTION_ORDER[activity.category].map(renderBodySection)}

          {activity.tags.length > 0 ? (
            <View style={styles.tagsRow}>
              {activity.tags.map((tag) => (
                <View key={tag} style={styles.tagPill}>
                  <Text style={styles.tagLabel}>{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {hasMapsKey() && (
            <Pressable
              onPress={openDirections}
              onFocus={mapFocus.onFocus}
              onBlur={mapFocus.onBlur}
              disabled={!hasValidCoordinates(activity.location) || ctaBusy}
              accessibilityRole="button"
              accessibilityLabel="Open in Google Maps"
              style={[
                styles.mapBox,
                mapFocus.focused && styles.mapBoxFocused,
              ]}
            >
              {hasValidCoordinates(activity.location) &&
              mapState !== 'broken' ? (
                <>
                  <Image
                    testID="activity-detail-map-image"
                    source={{
                      uri: staticMapUrl(
                        activity.location,
                        DETAIL_MAP_WIDTH,
                        DETAIL_MAP_HEIGHT,
                      ),
                    }}
                    style={styles.image}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    accessibilityIgnoresInvertColors
                    onLoad={() => setMapState('loaded')}
                    onError={() => setMapState('broken')}
                  />
                  {mapState === 'loading' && (
                    <Skeleton
                      width="100%"
                      height="100%"
                      style={styles.imageSkeleton}
                    />
                  )}
                </>
              ) : (
                <View style={styles.imageFallback}>
                  <MapPinOff
                    size={20}
                    color={colors.textMuted}
                    strokeWidth={1.75}
                  />
                </View>
              )}
            </Pressable>
          )}

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
                Ratings, reviews and photos for restaurants and bars are sourced from Tripadvisor and
                refreshed periodically. Roamly does not rate these places.
              </Text>
            </View>
          )}

          {/* T6: the Places-case analogue of the footer CTA above — never
              skeletoned (design-spec.md: "a single link that either exists
              after the merge or doesn't"); renders null on its own with no
              maps link. */}
          {isPlacesLive && <GoogleAttributionPlate variant="footer" googleMapsUri={activity.google_maps_uri} />}
        </View>
      </ScrollView>

      {ctaError && (
        <ErrorBanner message={ctaError} onDismiss={() => setCtaError(null)} />
      )}

      <View
        style={[styles.footer, { paddingBottom: space[6] + insets.bottom }]}
      >
        {bookingNote && (
          <View style={styles.bookingNote}>
            <Info size={16} color={colors.textMuted} strokeWidth={1.75} />
            <Text style={styles.bookingNoteText}>{bookingNote}</Text>
          </View>
        )}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space[2],
  },
  badge: {
    flexShrink: 1,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: space[1],
    paddingHorizontal: space[2],
  },
  badgeLabel: {
    // design-spec.md's reconciliation note: a 12px gold label reads as UI
    // (3.65:1, clears 3:1) but fails the 4.5:1 normal-text bar if treated as
    // body text — engineer's documented preference is `--text` cream here
    // (8.5:1, unambiguously AA), keeping the 1px gold border as the accent.
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.text,
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  metaText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  metaSeparator: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  metaExtraGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  statusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.success,
  },
  statusOpen: {
    fontSize: fontSize.sm,
    color: colors.success,
  },
  statusClosed: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  description: {
    fontSize: fontSize.md,
    color: colors.text,
    lineHeight: fontSize.md * 1.5,
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
  primaryButtonDisabled: {
    backgroundColor: colors.surfaceHover,
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
