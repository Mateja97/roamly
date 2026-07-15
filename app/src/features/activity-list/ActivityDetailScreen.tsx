import { useState } from 'react';
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
  ImageOff,
  MapPin,
  MapPinOff,
  Star,
} from 'lucide-react-native';
import type { Activity } from '../../api/activities';
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
  badgeLabel,
  factStripFields,
  genericActionLabel,
  openStatus,
  PRIMARY_CTA_LABEL,
  primaryCTAIsDirections,
  uniqueSection,
} from './activityDetailConfig';
import { DifficultyMeter } from './DifficultyMeter';
import { FactStrip } from './FactStrip';
import { UniqueSection } from './UniqueSection';

// design-spec.md's T4 "Shared base layout" section: header back control,
// hero photo (280px, standardized across categories), title/badge/rating,
// description, fact strip, unique section, bottom action bar. Pushed onto
// the existing hand-rolled stack by ActivityListScreen (see there) — no
// router, no new fetch (renders from the already-loaded `Activity`), so
// there's no loading/error/empty state here, only the async surfaces below
// (hero/map images, CTA OS-handoff failures).
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
  const insets = useSafeAreaInsets();
  const [heroState, setHeroState] = useState<'loading' | 'loaded' | 'broken'>(
    'loading',
  );
  const [mapState, setMapState] = useState<'loading' | 'loaded' | 'broken'>(
    'loading',
  );
  const [ctaBusy, setCtaBusy] = useState(false);
  const [ctaError, setCtaError] = useState<string | null>(null);
  const heroPhoto = activity.image_refs[0];
  const heroUri = heroPhoto?.uri;
  const metaText = showDistance
    ? `${activity.distance_km.toFixed(1)} km away`
    : activity.country;
  const status = openStatus(activity);
  const fields = factStripFields(activity);
  const unique = uniqueSection(activity);
  const isDirectionsPrimary = primaryCTAIsDirections(activity.category);
  const genericLabel = genericActionLabel(activity.category);

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
        </View>

        <PhotoAttributionCaption
          attribution={heroPhoto?.attribution}
          horizontalInset={space[6]}
        />

        <View style={styles.titleBlock}>
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

          <Text style={styles.title}>{activity.title}</Text>

          <View style={styles.metaRow}>
            <MapPin size={16} color={colors.textMuted} strokeWidth={1.75} />
            <Text style={styles.metaText}>{metaText}</Text>
            {status && (
              <>
                <Text style={styles.metaSeparator}>·</Text>
                <Text
                  style={
                    status.isOpen ? styles.statusOpen : styles.statusClosed
                  }
                >
                  {status.text}
                </Text>
              </>
            )}
          </View>

          {activity.description ? (
            <Text style={styles.description}>{activity.description}</Text>
          ) : null}

          {activity.category === 'sport' &&
            activity.details?.category === 'sport' &&
            activity.details.difficulty !== undefined && (
              <DifficultyMeter difficulty={activity.details.difficulty} />
            )}

          <FactStrip fields={fields} />

          <UniqueSection data={unique} />

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
            <View style={styles.mapBox}>
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
            </View>
          )}
        </View>
      </ScrollView>

      {ctaError && (
        <ErrorBanner message={ctaError} onDismiss={() => setCtaError(null)} />
      )}

      <View
        style={[styles.footer, { paddingBottom: space[6] + insets.bottom }]}
      >
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
          onPress={isDirectionsPrimary ? openDirections : undefined}
          onFocus={primaryFocus.onFocus}
          onBlur={primaryFocus.onBlur}
          disabled={!isDirectionsPrimary || ctaBusy}
          accessibilityRole="button"
          accessibilityLabel={PRIMARY_CTA_LABEL[activity.category]}
          accessibilityState={{ disabled: !isDirectionsPrimary }}
          style={[
            styles.primaryButton,
            !isDirectionsPrimary && styles.primaryButtonDisabled,
            isDirectionsPrimary &&
              primaryFocus.focused &&
              styles.primaryButtonFocused,
          ]}
        >
          <Text
            style={[
              styles.primaryLabel,
              !isDirectionsPrimary && styles.primaryLabelDisabled,
            ]}
          >
            {PRIMARY_CTA_LABEL[activity.category]}
          </Text>
        </Pressable>
      </View>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
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
    flexDirection: 'row',
    gap: space[3],
    paddingHorizontal: space[6],
    paddingTop: space[4],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
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
