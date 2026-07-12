import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { ImageOff, MapPin, Star } from 'lucide-react-native';
import type { Activity } from '../api/activities';
import { CATEGORY_LABELS, PRICE_TIER_LABELS } from '../features/activity-list/filters';
import { colors, fontSize, radius, space } from '../theme/tokens';
import { Skeleton } from './Skeleton';

type ActivityCardProps = {
  activity: Activity;
  /** outside_country's distance_km is always 0 (no distance concept there) — show the country instead. */
  showDistance: boolean;
};

// DESIGN_STANDARDS.md's Activity card recipe: 3:2 image on top (reserved
// box, loading/broken states), then a --surface body with category badge +
// rating on row 1, title, and a meta row of distance/location + price tier.
export function ActivityCard({ activity, showDistance }: ActivityCardProps) {
  const [imageState, setImageState] = useState<'loading' | 'loaded' | 'broken'>('loading');
  const imageUri = activity.image_refs[0];

  const metaText = showDistance ? `${activity.distance_km.toFixed(1)} km away` : activity.country;

  return (
    <View
      style={styles.card}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${activity.title}, ${CATEGORY_LABELS[activity.category]}, rated ${activity.rating.toFixed(1)}, ${PRICE_TIER_LABELS[activity.price_tier]}, ${metaText}`}
    >
      <View style={styles.imageBox}>
        {imageUri && imageState !== 'broken' ? (
          <Image
            testID="activity-card-image"
            source={{ uri: imageUri }}
            style={styles.image}
            onLoad={() => setImageState('loaded')}
            onError={() => setImageState('broken')}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={styles.imageFallback}>
            <ImageOff size={20} color={colors.textMuted} strokeWidth={1.75} />
          </View>
        )}
        {imageUri && imageState === 'loading' && <Skeleton width="100%" height="100%" style={styles.imageSkeleton} />}
      </View>

      <View style={styles.body}>
        <View style={styles.row}>
          <View style={styles.badge}>
            <Text style={styles.badgeLabel}>{CATEGORY_LABELS[activity.category]}</Text>
          </View>
          <View style={styles.rating}>
            <Star size={16} color={colors.primary} strokeWidth={1.75} fill={colors.primary} />
            <Text style={styles.ratingLabel}>{activity.rating.toFixed(1)}</Text>
          </View>
        </View>

        <Text style={styles.title} numberOfLines={2}>
          {activity.title}
        </Text>

        <View style={styles.metaRow}>
          <MapPin size={16} color={colors.textMuted} strokeWidth={1.75} />
          <Text style={styles.metaText}>{metaText}</Text>
          <Text style={styles.metaText}>·</Text>
          <Text style={styles.metaText}>{PRICE_TIER_LABELS[activity.price_tier]}</Text>
        </View>
      </View>
    </View>
  );
}

// Same footprint as the loaded card — zero jump when real cards arrive.
export function ActivityCardSkeleton() {
  return (
    <View style={styles.card} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.imageBox}>
        <Skeleton width="100%" height="100%" />
      </View>
      <View style={styles.body}>
        <View style={styles.row}>
          <Skeleton width={90} height={20} />
          <Skeleton width={40} height={16} />
        </View>
        <Skeleton width="80%" height={20} style={styles.skeletonLine} />
        <Skeleton width="50%" height={16} style={styles.skeletonLine} />
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
    borderRadius: radius.default,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  imageBox: {
    width: '100%',
    aspectRatio: 3 / 2,
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
  body: {
    padding: space[4],
    gap: space[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    borderWidth: 1,
    borderColor: colors.textMuted,
    borderRadius: radius.full,
    paddingVertical: space[1],
    paddingHorizontal: space[2],
  },
  badgeLabel: {
    fontSize: fontSize.xs,
    fontWeight: '500',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  ratingLabel: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  title: {
    fontSize: fontSize.lg,
    color: colors.text,
    fontWeight: '500',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    flexWrap: 'wrap',
  },
  metaText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  skeletonLine: {
    marginTop: space[1],
  },
});
