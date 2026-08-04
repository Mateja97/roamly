import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Line } from 'react-native-svg';
import { ArrowRight, ImageOff, MapPin, Star } from 'lucide-react-native';
import type { Activity } from '../api/activities';
import { tripadvisorAttribution } from '../features/activity-list/activityDetailConfig';
import { CATEGORY_LABELS } from '../features/activity-list/filters';
import { useFocusable } from '../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../theme/tokens';
import { PhotoAttributionCaption } from './PhotoAttributionCaption';
import { Skeleton } from './Skeleton';
import { TripadvisorAttributionPlate } from './TripadvisorAttributionPlate';

type ActivityCardProps = {
  activity: Activity;
  /** When the active scope has no location anchor, distance_km is always 0 — show the country instead. */
  showDistance: boolean;
  onPress: () => void;
};

const IMAGE_HEIGHT = 150;
const NOTCH_SIZE = 16;
const GO_BUTTON_SIZE = 38;

// DESIGN_STANDARDS.md's Activity card recipe: a torn-boarding-pass "ticket"
// card — cover image with category/rating overlay pills, a dashed
// perforation seam with two page-bg notches, then a gradient body (title,
// optional description, distance/location + a decorative go-arrow). No tags
// row and no price/cost signage anywhere in the flow. The whole card is one
// tap control — `onPress` opens the activity's detail screen; pressed/
// focused states swap the body bg / add a focus border per the
// interactive-states addendum in DESIGN_STANDARDS.md's card recipe.
// Memoized so a FlatList row only re-renders when its own props change —
// unrelated screen state (filter sheet open, other rows) doesn't force a
// re-render of every card.
export const ActivityCard = memo(function ActivityCard({ activity, showDistance, onPress }: ActivityCardProps) {
  const [imageState, setImageState] = useState<'loading' | 'loaded' | 'broken'>('loading');
  const focus = useFocusable();
  const photo = activity.image_refs[0];
  const imageUri = photo?.uri;
  // design-spec.md T8 (Tripadvisor initiative): presence of this field is
  // the sole detection signal for the Tripadvisor-branded treatment below.
  const tripadvisor = tripadvisorAttribution(activity);

  const metaText = showDistance ? `${activity.distance_km.toFixed(1)} km away` : activity.country;

  const label = [
    `${activity.title}, ${CATEGORY_LABELS[activity.category]}, ${
      // compliance rule 03: no Roamly rating is shown for a Tripadvisor row,
      // so none is announced — "Tripadvisor, {N} reviews" replaces it.
      tripadvisor
        ? `Tripadvisor, ${tripadvisor.review_count.toLocaleString('en-US')} reviews`
        : `rated ${activity.rating.toFixed(1)}`
    }, ${metaText}`,
    activity.description || null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    // accessible={false} on the outer Pressable: it must NOT collapse everything below
    // (including PhotoAttributionCaption's own link) into one accessibility node. The
    // card-wide `label` instead lives on the body View below — a touch on any accessible
    // descendant still lands inside the outer Pressable's bounds and fires onPress — so
    // the attribution link (its own accessible Pressable, a sibling of body) stays
    // independently reachable instead of being swallowed into the card's group.
    <Pressable
      onPress={onPress}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      accessible={false}
      style={[styles.card, focus.focused && styles.cardFocused]}
    >
      {({ pressed }) => (
        <>
          <View style={styles.imageBox}>
            {imageUri && imageState !== 'broken' ? (
              <Image
                testID="activity-card-image"
                source={{ uri: imageUri }}
                style={styles.image}
                contentFit="cover"
                cachePolicy="memory-disk"
                accessibilityIgnoresInvertColors
                onLoad={() => setImageState('loaded')}
                onError={() => setImageState('broken')}
              />
            ) : (
              <View style={styles.imageFallback}>
                <ImageOff size={20} color={colors.textMuted} strokeWidth={1.75} />
              </View>
            )}
            {imageUri && imageState === 'loading' && (
              <Skeleton width="100%" height="100%" style={styles.imageSkeleton} />
            )}

            <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Text style={styles.badgeLabel}>{CATEGORY_LABELS[activity.category]}</Text>
            </View>
            {/* compliance rule 03: never a Roamly star blended/adjacent with a
                partner rating — omitted entirely for a Tripadvisor row. */}
            {!tripadvisor && (
              <View style={styles.ratingPill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Star size={13} color={colors.primary} strokeWidth={1.75} fill={colors.primary} />
                <Text style={styles.ratingLabel}>{activity.rating.toFixed(1)}</Text>
              </View>
            )}
          </View>

          <PhotoAttributionCaption attribution={photo?.attribution} horizontalInset={space[4]} />

          {/* ponytail: notches below are positioned from the fixed IMAGE_HEIGHT, so
              they sit exactly on the seam only when no attribution caption renders
              between the image and the seam — attribution is rare (pre-T3 photos
              carry none) and misaligning by a caption's height in that case is a
              cosmetic gap, not worth measuring layout for. */}
          <View style={styles.seam} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Svg width="100%" height={2}>
              <Line x1={0} y1={1} x2="100%" y2={1} stroke={colors.border} strokeWidth={2} strokeDasharray="2 12" />
            </Svg>
          </View>

          <View
            style={[styles.body, pressed && styles.bodyPressed]}
            accessible
            accessibilityRole="button"
            accessibilityLabel={label}
          >
            {!pressed && (
              <LinearGradient colors={colors.surfaceGradient} style={StyleSheet.absoluteFill} pointerEvents="none" />
            )}

            <Text style={styles.title} numberOfLines={2}>
              {activity.title}
            </Text>

            {activity.description ? (
              <Text style={styles.description} numberOfLines={2}>
                {activity.description}
              </Text>
            ) : null}

            {tripadvisor && (
              <TripadvisorAttributionPlate tripadvisor={tripadvisor} rating={activity.rating} variant="card" />
            )}

            <View style={styles.metaRow}>
              <View style={styles.metaLeft}>
                <MapPin size={15} color={colors.primary} strokeWidth={1.75} />
                <Text style={styles.metaText} numberOfLines={1}>
                  {metaText}
                </Text>
              </View>
              <View
                testID="activity-card-go-button"
                style={styles.goCircle}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <ArrowRight size={17} color={colors.ink} strokeWidth={2.4} />
              </View>
            </View>
          </View>

          <View style={styles.notchLeft} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          <View style={styles.notchRight} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
        </>
      )}
    </Pressable>
  );
});

// Same footprint as the loaded card — zero jump when real cards arrive.
export function ActivityCardSkeleton() {
  return (
    <View style={styles.card} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.imageBox}>
        <Skeleton width="100%" height="100%" />
      </View>
      {/* ponytail: skeleton reuses the plain seam gap (no dashed line/notches) — the
          spec allows either, and a static seam is one fewer thing to keep in sync. */}
      <View style={styles.seam} />
      <View style={styles.body}>
        <Skeleton width="80%" height={20} />
        <Skeleton width="100%" height={16} style={styles.skeletonLine} />
        <Skeleton width="70%" height={16} style={styles.skeletonLine} />
        <View style={[styles.metaRow, styles.skeletonLine]}>
          <Skeleton width={90} height={16} />
          <View style={styles.goCircleSkeleton} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 1,
    borderTopColor: colors.cardHighlight,
    borderRadius: radius.lg,
    overflow: 'hidden',
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  cardFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  imageBox: {
    width: '100%',
    height: IMAGE_HEIGHT,
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
  badge: {
    position: 'absolute',
    top: space[3],
    left: space[3],
    backgroundColor: colors.scrim,
    borderRadius: radius.full,
    paddingVertical: space[1],
    paddingHorizontal: space[2],
  },
  badgeLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.text,
  },
  ratingPill: {
    position: 'absolute',
    top: space[3],
    right: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    backgroundColor: colors.scrim,
    borderRadius: radius.full,
    paddingVertical: space[1],
    paddingHorizontal: space[2],
  },
  ratingLabel: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  seam: {
    width: '100%',
    height: 2,
    paddingHorizontal: NOTCH_SIZE,
  },
  notchLeft: {
    position: 'absolute',
    left: -NOTCH_SIZE / 2,
    top: IMAGE_HEIGHT - NOTCH_SIZE / 2,
    width: NOTCH_SIZE,
    height: NOTCH_SIZE,
    borderRadius: NOTCH_SIZE / 2,
    backgroundColor: colors.bg,
  },
  notchRight: {
    position: 'absolute',
    right: -NOTCH_SIZE / 2,
    top: IMAGE_HEIGHT - NOTCH_SIZE / 2,
    width: NOTCH_SIZE,
    height: NOTCH_SIZE,
    borderRadius: NOTCH_SIZE / 2,
    backgroundColor: colors.bg,
  },
  body: {
    padding: space[4],
    gap: space[2],
  },
  bodyPressed: {
    backgroundColor: colors.surfaceHover,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
  },
  description: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    flexShrink: 1,
  },
  metaText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  goCircle: {
    width: GO_BUTTON_SIZE,
    height: GO_BUTTON_SIZE,
    borderRadius: GO_BUTTON_SIZE / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  goCircleSkeleton: {
    width: GO_BUTTON_SIZE,
    height: GO_BUTTON_SIZE,
    borderRadius: GO_BUTTON_SIZE / 2,
    backgroundColor: colors.surfaceHover,
  },
  skeletonLine: {
    marginTop: space[1],
  },
});
