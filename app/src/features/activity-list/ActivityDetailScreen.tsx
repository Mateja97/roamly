import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { ArrowUpRight, Info } from 'lucide-react-native';
import type { Activity } from '../../api/activities';
import { hasValidCoordinates } from '../../api/staticMap';
import { ErrorBanner } from '../../components/ErrorBanner';
import { GoogleAttributionPlate } from '../../components/GoogleAttributionPlate';
import { PhotoAttributionCaption } from '../../components/PhotoAttributionCaption';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { ActionChips, type ActionChipItem } from './ActionChips';
import { bodySectionOrder, PRIMARY_CTA_LABEL } from './activityDetailConfig';
import { useActivityDetailData } from './useActivityDetailData';
import { useOSHandoff } from './useOSHandoff';
import { DetailBody } from './DetailBody';
import { DetailMapBox } from './DetailMapBox';
import { DetailTitleBlock } from './DetailTitleBlock';
import { ReviewsSkeleton } from './DetailSkeletons';
import { HeroCarousel } from './HeroCarousel';
import { HoursRow } from './HoursRow';
import { PhotoViewerModal } from './PhotoViewerModal';
import { ReviewsSection } from './ReviewsSection';
import { TripadvisorBlock } from './TripadvisorBlock';
import { WeekHoursModal } from './WeekHoursModal';

// design-spec.md's "Shared base layout" section: hero photo carousel (owns
// the back control + top safe-area inset — see HeroCarousel), title/badge/
// rating, description, fact strip, unique section, bottom action bar.
// Pushed onto the existing hand-rolled stack by ActivityListScreen (see
// there) — no router. Renders from the already-loaded `Activity`
// immediately (no blocking loading/error/empty state), then fires the
// photo-set upgrade fetch in the background — see the `photos` state below
// for that surface — and the live-details upgrade fetch (see the `activity`
// state below), which skeletons the Places-backed blocks (rating/fact-strip/
// description/unique-section/reviews) while pending and merges onto them on
// success. Other async surfaces here: hero/map images, CTA OS-handoff
// failures.
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

export function ActivityDetailScreen({
  activity: seedActivity,
  showDistance,
  onBack,
}: ActivityDetailScreenProps) {
  const genericFocus = useFocusable();
  const primaryFocus = useFocusable();
  const tripadvisorLinkFocus = useFocusable();
  const insets = useSafeAreaInsets();
  // null = closed; a number = open the fullscreen viewer at that page
  // (the hero carousel's current page — continuity between the two).
  // Fewer than 2 photos never opens this (the hero's pill hides itself).
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // The full-week modal, same conditional-mount pattern as the photo viewer
  // above.
  const [hoursModalOpen, setHoursModalOpen] = useState(false);
  const {
    activity, photos, heroIndex, setHeroIndex, detailsPending, isPlacesLive,
    metaText, levelChipText, todayRow, metaChipStatus, weekData,
    metaExtras, fields, foldedValue, kidsAge, unique, goodToKnow,
    toursChecklist, toursItineraryData, meetingPointText, isDirectionsPrimary,
    genericLabel, websiteURL, primaryEnabled, attribution, bookingNote,
    googleReviewsAllowed, showRatingCluster, ratingSkeletonShown, tripadvisor,
    reviews, address, eyebrow, showMetaRow, googleReviewsCardShown,
    description, descriptionPending,
  } = useActivityDetailData(seedActivity, showDistance);
  const {
    ctaBusy, ctaError, setCtaError, openDirections, openShare,
    openExternalLink, handleCallPhone,
  } = useOSHandoff(activity);
  const heroPhoto = photos[heroIndex];

  function handleGenericPress() {
    return genericLabel === 'Directions' ? openDirections() : openShare();
  }

  function handlePrimaryPress() {
    if (isDirectionsPrimary) return openDirections();
    if (websiteURL) return openExternalLink(websiteURL);
  }

  const mapDisabled = !hasValidCoordinates(activity.location) || ctaBusy;

  // design-spec.md's "Action chips" slot (§B2) — a fixed slot in the
  // canonical order for every category, right after the title block, not a
  // per-category opt-in. Sourced entirely from fields the bottom
  // bar/generic actions already use above (`openDirections`/`websiteURL`/
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
      // sources a venue's own external link (`website_url`, on every
      // category), never `tripadvisor.web_url`.
      websiteURL ? { kind: 'website', onPress: () => openExternalLink(websiteURL) } : undefined,
      tripadvisorPhone ? { kind: 'call', onPress: () => handleCallPhone(tripadvisorPhone) } : undefined,
      { kind: 'share', onPress: openShare },
    ] as (ActionChipItem | undefined)[]
  ).filter((item): item is ActionChipItem => item !== undefined);

  return (
    // The hero owns the top safe-area inset (its overlaid back control
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
          <DetailTitleBlock
            activity={activity}
            attribution={attribution}
            tripadvisor={tripadvisor}
            showRatingCluster={showRatingCluster}
            ratingSkeletonShown={ratingSkeletonShown}
            eyebrow={eyebrow}
            showMetaRow={showMetaRow}
            metaText={metaText}
            kidsAge={kidsAge}
            metaExtras={metaExtras}
            foldedValue={foldedValue}
            metaChipStatus={metaChipStatus}
            levelChipText={levelChipText}
          />

          {/* design-spec.md's "Action chips" slot (§B2): fixed slot in the
              canonical order, right after the meta line — see
              `actionChipItems` above. */}
          <ActionChips items={actionChipItems} />

          {/* design-spec.md's "Hours row" slot (§B3): relocated out of the
              stat grid entirely into its own tappable disclosure row —
              present only when structured opening_hours is usable (same
              `todayHoursRow` gate the screen already had). Canonical
              order: hero → title block → action chips → hours row → stat
              grid → ... */}
          <HoursRow data={todayRow} onPress={() => setHoursModalOpen(true)} />

          {bodySectionOrder(activity.category).map((section) => (
            <DetailBody
              key={section}
              section={section}
              activity={activity}
              isPlacesLive={isPlacesLive}
              detailsPending={detailsPending}
              description={description}
              descriptionPending={descriptionPending}
              fields={fields}
              unique={unique}
              goodToKnow={goodToKnow}
              toursChecklist={toursChecklist}
              toursItineraryData={toursItineraryData}
              meetingPointText={meetingPointText}
              onMapPress={openDirections}
              mapDisabled={mapDisabled}
            />
          ))}

          {activity.tags.length > 0 ? (
            <View style={styles.tagsRow}>
              {activity.tags.map((tag, i) => (
                <View key={i} style={styles.tagPill}>
                  <Text style={styles.tagLabel}>{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* design-spec.md's "Reviews" slot (§B10): one shared wrapper
              around the mutually-exclusive TripadvisorBlock/
              GoogleAttributionPlate content. Neither compliance-critical
              attribution plate is touched — this only owns the outer
              score/distribution/"See all" layout around them. Canonical
              spot: after good-to-know, before the map — "... →
              good-to-know → reviews → map → bottom bar".
              tripadvisor-marks-require-reviews (T2): `tripadvisor` is
              `tripadvisorAttribution(activity)`, gated to a quotable
              review — a review-less row falls through to the isPlacesLive
              branch below instead (Google score + attribution, same path
              every other Places-sourced category takes). */}
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

          {/* The Places-case analogue of the TripadvisorBlock spot above —
              mutually exclusive with it (a row with its own Tripadvisor
              reviews is never `isPlacesLive`; a review-less Tripadvisor row
              IS `isPlacesLive` post-T2 and renders here instead, same as
              any other Places-sourced category). Skeletoned only while
              pending and genuinely empty; GoogleAttributionPlate renders
              nothing on its own once merged with no reviews/maps link
              (silent degrade, no error UI). No generic score/distribution
              header for the TripadvisorBlock case above — compliance rule
              03 forbids a second, Roamly-drawn aggregate rating beside
              Tripadvisor's own attribution plate.
              `googleReviewsAllowed` gates only the content branch, not the
              skeleton — a pending row that already has reviews (content
              genuinely exists) but no maps link falls through to neither
              branch, per the compliance comment on that flag above. */}
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
          {!(activity.details?.category === 'tours_experiences' && meetingPointText) && (
            <DetailMapBox
              activity={activity}
              onPress={openDirections}
              disabled={mapDisabled}
            />
          )}

          {/* design-spec.md's Footer CTAs + disclaimer section: the
              deep-link button + disclaimer are the trailing elements of the
              scrollable content — after facts/map, right before the pinned
              Directions/Book-a-table footer bar. ("Add to my trip" is
              out of scope — no existing trip/itinerary action to wire it
              to.) */}
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
  titleBlock: {
    paddingHorizontal: space[6],
    paddingTop: space[6],
    gap: space[6],
  },
  tripadvisorFooterCta: {
    gap: space[4],
  },
  tripadvisorLinkButton: {
    // design-spec.md's 5b footer: sole footer CTA, filled Primary
    // (DESIGN_STANDARDS.md's Buttons table).
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
