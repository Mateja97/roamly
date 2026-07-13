import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ImageOff, MapPin, Star } from 'lucide-react-native';
import type { Activity } from '../api/activities';
import { CATEGORY_LABELS } from '../features/activity-list/filters';
import { useFocusable } from '../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../theme/tokens';
import { MapThumbnail } from './MapThumbnail';
import { PhotoAttributionCaption } from './PhotoAttributionCaption';
import { Skeleton } from './Skeleton';

const MAX_TAGS = 3;

type ActivityCardProps = {
  activity: Activity;
  /** my_country's distance_km is always 0 (no distance concept there) — show the country instead. */
  showDistance: boolean;
  onPress: () => void;
};

// DESIGN_STANDARDS.md's Activity card recipe: 3:2 image on top (reserved
// box, loading/broken states), then a --surface body with category badge +
// rating on row 1, title, an optional description snippet, an optional tags
// row, and a location row (map thumbnail + distance/location text). No
// price/cost signage anywhere in the flow (T1); the price-tier field was
// dropped from the client contract entirely (T2). The whole card is one tap
// control (T1) — `onPress` opens the activity's detail screen; pressed/
// focused states swap the card bg / add a focus border per the
// interactive-states addendum in DESIGN_STANDARDS.md's card recipe.
export function ActivityCard({ activity, showDistance, onPress }: ActivityCardProps) {
  const [imageState, setImageState] = useState<'loading' | 'loaded' | 'broken'>('loading');
  const focus = useFocusable();
  const photo = activity.image_refs[0];
  const imageUri = photo?.uri;

  const metaText = showDistance ? `${activity.distance_km.toFixed(1)} km away` : activity.country;
  const tags = activity.tags.slice(0, MAX_TAGS);

  const label = [
    `${activity.title}, ${CATEGORY_LABELS[activity.category]}, rated ${activity.rating.toFixed(1)}, ${metaText}`,
    activity.description || null,
    tags.length > 0 ? `Tags: ${tags.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Pressable
      onPress={onPress}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed, focus.focused && styles.cardFocused]}
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

      <PhotoAttributionCaption attribution={photo?.attribution} horizontalInset={space[4]} />

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

        {activity.description ? (
          <Text style={styles.description} numberOfLines={2}>
            {activity.description}
          </Text>
        ) : null}

        {tags.length > 0 ? (
          <View style={styles.tagsRow}>
            {tags.map((tag) => (
              <View key={tag} style={styles.tagPill}>
                <Text style={styles.tagLabel} numberOfLines={1}>
                  {tag}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.locationRow}>
          <MapThumbnail location={activity.location} />
          <View style={styles.metaRow}>
            <MapPin size={16} color={colors.textMuted} strokeWidth={1.75} />
            <Text style={styles.metaText}>{metaText}</Text>
          </View>
        </View>
      </View>
    </Pressable>
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
        <Skeleton width="100%" height={16} style={styles.skeletonLine} />
        <Skeleton width="70%" height={16} style={styles.skeletonLine} />
        <View style={[styles.locationRow, styles.skeletonLine]}>
          <Skeleton width={72} height={72} />
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
    borderRadius: radius.default,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  cardPressed: {
    backgroundColor: colors.surfaceHover,
  },
  cardFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
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
  description: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  tagsRow: {
    flexDirection: 'row',
    gap: space[1],
    overflow: 'hidden',
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
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  metaRow: {
    flex: 1,
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
