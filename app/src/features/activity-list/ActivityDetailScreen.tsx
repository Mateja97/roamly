import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
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
import {
  ChevronLeft,
  Images,
  ImageOff,
  Info,
  MapPin,
  MapPinOff,
  Star,
} from 'lucide-react-native';
import type { Activity, ActivityPhoto } from '../../api/activities';
import { getActivityPhotos } from '../../api/activities';
import {
  hasMapsKey,
  hasValidCoordinates,
  staticMapUrl,
} from '../../api/staticMap';
import { ErrorBanner } from '../../components/ErrorBanner';
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
  uniqueSection,
  wellnessBookingNote,
  type BodySection,
} from './activityDetailConfig';
import { DifficultyMeter } from './DifficultyMeter';
import { FactStrip } from './FactStrip';
import { PhotoViewerModal } from './PhotoViewerModal';
import { UniqueSection } from './UniqueSection';

// design-spec.md's T4 "Shared base layout" section: header back control,
// hero photo (280px, standardized across categories), title/badge/rating,
// description, fact strip, unique section, bottom action bar. Pushed onto
// the existing hand-rolled stack by ActivityListScreen (see there) — no
// router. Renders from the already-loaded `Activity` immediately (no
// blocking loading/error/empty state), then fires the T4 photo-set upgrade
// fetch in the background — see the `photos` state below for that surface.
// Other async surfaces here: hero/map images, CTA OS-handoff failures.
const HERO_HEIGHT = 280;
const DETAIL_MAP_WIDTH = 600;
const DETAIL_MAP_HEIGHT = 400; // 3:2, per the map box's reserved aspect ratio.

type ActivityDetailScreenProps = {
  activity: Activity;
  showDistance: boolean;
  onBack: () => void;
};

export function ActivityDetailScreen({
  activity,
  showDistance,
  onBack,
}: ActivityDetailScreenProps) {
  const backFocus = useFocusable();
  const genericFocus = useFocusable();
  const primaryFocus = useFocusable();
  const mapFocus = useFocusable();
  const photosFocus = useFocusable();
  const insets = useSafeAreaInsets();
  const [heroState, setHeroState] = useState<'loading' | 'loaded' | 'broken'>(
    'loading',
  );
  const [mapState, setMapState] = useState<'loading' | 'loaded' | 'broken'>(
    'loading',
  );
  const [ctaBusy, setCtaBusy] = useState(false);
  const [ctaError, setCtaError] = useState<string | null>(null);
  // T4: fewer than 2 photos hides the pill entirely (driven by the photo
  // count, not the hero's own loading/broken state) — a single-photo pill
  // opening a one-slide viewer is noise, per design-spec.md.
  const [viewerOpen, setViewerOpen] = useState(false);
  // T4: starts as the provisional list data, upgrades in place once T3's
  // GET /activities/{id}/photos resolves. `image_refs[0]` is guaranteed to
  // stay the same photo pre/post-upgrade (T2 persists it first), so the
  // hero never swaps/reloads — only `photos.length` (the count pill) and
  // the viewer's slide count change. Failure/timeout leaves this untouched
  // — no error UI, per design-spec.md. ActivityListScreen only ever mounts
  // this screen fresh per open (`{selectedActivity && <ActivityDetailScreen
  // .../>}`), never swaps `activity` on an already-mounted instance, so
  // there's no reset-on-prop-change case to handle here.
  const [photos, setPhotos] = useState<ActivityPhoto[]>(activity.image_refs);
  useEffect(() => {
    let cancelled = false;
    getActivityPhotos(activity.id).then((result) => {
      if (!cancelled && result.status === 'success') setPhotos(result.image_refs);
    });
    return () => {
      cancelled = true;
    };
  }, [activity.id]);
  const heroPhoto = photos[0];
  const heroUri = heroPhoto?.uri;
  const metaText = showDistance
    ? `${activity.distance_km.toFixed(1)} km away`
    : activity.country;
  const status = openStatus(activity);
  const metaExtras = metaRowExtras(activity);
  const fields = factStripFields(activity);
  const unique = uniqueSection(activity);
  const isDirectionsPrimary = primaryCTAIsDirections(activity.category);
  const genericLabel = genericActionLabel(activity.category);
  const actionURL = primaryActionURL(activity);
  const primaryEnabled = isDirectionsPrimary || Boolean(actionURL);
  const attribution = artAttribution(activity);
  const bookingNote = wellnessBookingNote(activity);

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

  // design-spec.md T8 addendum #3: per-category body-section order.
  // FactStrip/UniqueSection/DifficultyMeter each already render nothing
  // when their own data is absent, so this only controls order, not
  // per-section omission.
  function renderBodySection(section: BodySection): ReactNode {
    switch (section) {
      case 'description':
        return activity.description ? (
          <Text key="description" style={styles.description}>
            {activity.description}
          </Text>
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
        return <FactStrip key="factstrip" fields={fields} />;
      case 'unique':
        return <UniqueSection key="unique" data={unique} />;
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          onFocus={backFocus.onFocus}
          onBlur={backFocus.onBlur}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={[
            styles.backButton,
            backFocus.focused && styles.backButtonFocused,
          ]}
        >
          <ChevronLeft size={16} color={colors.textMuted} strokeWidth={1.75} />
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.heroBox}>
          {heroUri && heroState !== 'broken' ? (
            <Image
              testID="activity-detail-hero-image"
              source={{ uri: heroUri }}
              style={styles.image}
              contentFit="cover"
              cachePolicy="memory-disk"
              accessibilityIgnoresInvertColors
              onLoad={() => setHeroState('loaded')}
              onError={() => setHeroState('broken')}
            />
          ) : (
            <View style={styles.imageFallback}>
              <ImageOff size={20} color={colors.textMuted} strokeWidth={1.75} />
            </View>
          )}
          {heroUri && heroState === 'loading' && (
            <Skeleton width="100%" height="100%" style={styles.imageSkeleton} />
          )}
          {photos.length >= 2 && (
            <Pressable
              onPress={() => setViewerOpen(true)}
              onFocus={photosFocus.onFocus}
              onBlur={photosFocus.onBlur}
              accessibilityRole="button"
              accessibilityLabel={`View ${photos.length} photos`}
              style={[
                styles.photosPill,
                photosFocus.focused && styles.photosPillFocused,
              ]}
            >
              <Images size={16} color={colors.text} strokeWidth={1.75} />
              <Text style={styles.photosPillLabel}>
                {`Photos ${photos.length}`}
              </Text>
            </Pressable>
          )}
        </View>

        <PhotoAttributionCaption
          attribution={heroPhoto?.attribution}
          horizontalInset={space[6]}
        />

        <View style={styles.titleBlock}>
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

            <View style={styles.row}>
              <View style={styles.badge}>
                <Text style={styles.badgeLabel}>{badgeLabel(activity)}</Text>
              </View>
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
            </View>
          </View>

          <Text style={styles.title}>{activity.title}</Text>

          <View style={styles.metaRow}>
            {activity.category === 'nightlife' && status ? (
              // design-spec.md T8 addendum #9: the status dot + label is the
              // only place a leading status dot appears, and sits first,
              // before the usual "·"-separated items.
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
                <MapPin size={16} color={colors.textMuted} strokeWidth={1.75} />
                <Text style={styles.metaText}>{metaText}</Text>
                {metaExtras.map((extra) => (
                  <View key={extra} style={styles.metaExtraGroup}>
                    <Text style={styles.metaSeparator}>·</Text>
                    <Text style={styles.metaText}>{extra}</Text>
                  </View>
                ))}
                {status && (
                  <View style={styles.metaExtraGroup}>
                    <Text style={styles.metaSeparator}>·</Text>
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

      {viewerOpen && (
        <PhotoViewerModal
          photos={photos}
          activityTitle={activity.title}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingVertical: space[4],
    paddingHorizontal: space[6],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space[1],
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: space[2],
    borderRadius: radius.default,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  backButtonFocused: {
    backgroundColor: colors.surfaceHover,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  backLabel: {
    fontSize: fontSize.md,
    color: colors.textMuted,
  },
  body: {
    paddingBottom: space[8],
  },
  heroBox: {
    width: '100%',
    height: HERO_HEIGHT,
    borderRadius: radius.default,
    overflow: 'hidden',
    backgroundColor: colors.surfaceHover,
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
  photosPill: {
    position: 'absolute',
    right: space[3],
    bottom: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    minHeight: 44,
    backgroundColor: colors.scrim,
    borderRadius: radius.full,
    paddingVertical: space[1],
    paddingHorizontal: space[2],
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  photosPillFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  photosPillLabel: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontVariant: ['tabular-nums'],
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
