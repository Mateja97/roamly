import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, ImageOff, MapPin, MapPinOff, Star } from 'lucide-react-native';
import type { Activity } from '../../api/activities';
import { hasMapsKey, hasValidCoordinates, staticMapUrl } from '../../api/staticMap';
import { Skeleton } from '../../components/Skeleton';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { CATEGORY_LABELS } from './filters';

// design-spec.md's T1 "Activity detail screen" section: header back control,
// hero photo, title/rating/meta, full description, all tags, a larger
// static map. Pushed onto the existing hand-rolled stack by
// ActivityListScreen (see there) — no router, no new fetch (renders from the
// already-loaded `Activity`), so there's no loading/error/empty state here,
// only the two async image surfaces below.
const DETAIL_MAP_WIDTH = 600;
const DETAIL_MAP_HEIGHT = 400; // 3:2, per the map box's reserved aspect ratio.

type ActivityDetailScreenProps = {
  activity: Activity;
  showDistance: boolean;
  onBack: () => void;
};

export function ActivityDetailScreen({ activity, showDistance, onBack }: ActivityDetailScreenProps) {
  const backFocus = useFocusable();
  const [heroState, setHeroState] = useState<'loading' | 'loaded' | 'broken'>('loading');
  const [mapState, setMapState] = useState<'loading' | 'loaded' | 'broken'>('loading');
  const heroUri = activity.image_refs[0];
  const metaText = showDistance ? `${activity.distance_km.toFixed(1)} km away` : activity.country;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          onFocus={backFocus.onFocus}
          onBlur={backFocus.onBlur}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={[styles.backButton, backFocus.focused && styles.backButtonFocused]}
        >
          <ChevronLeft size={16} color={colors.textMuted} strokeWidth={1.75} />
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.imageBox}>
          {heroUri && heroState !== 'broken' ? (
            <Image
              testID="activity-detail-hero-image"
              source={{ uri: heroUri }}
              style={styles.image}
              onLoad={() => setHeroState('loaded')}
              onError={() => setHeroState('broken')}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={styles.imageFallback}>
              <ImageOff size={20} color={colors.textMuted} strokeWidth={1.75} />
            </View>
          )}
          {heroUri && heroState === 'loading' && <Skeleton width="100%" height="100%" style={styles.imageSkeleton} />}
        </View>

        <View style={styles.titleBlock}>
          <View style={styles.row}>
            <View style={styles.badge}>
              <Text style={styles.badgeLabel}>{CATEGORY_LABELS[activity.category]}</Text>
            </View>
            <View style={styles.rating}>
              <Star size={16} color={colors.primary} strokeWidth={1.75} fill={colors.primary} />
              <Text style={styles.ratingLabel}>{activity.rating.toFixed(1)}</Text>
            </View>
          </View>

          <Text style={styles.title}>{activity.title}</Text>

          <View style={styles.metaRow}>
            <MapPin size={16} color={colors.textMuted} strokeWidth={1.75} />
            <Text style={styles.metaText}>{metaText}</Text>
          </View>

          {activity.description ? <Text style={styles.description}>{activity.description}</Text> : null}

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
            <View style={styles.imageBox}>
              {hasValidCoordinates(activity.location) && mapState !== 'broken' ? (
                <>
                  <Image
                    testID="activity-detail-map-image"
                    source={{ uri: staticMapUrl(activity.location, DETAIL_MAP_WIDTH, DETAIL_MAP_HEIGHT) }}
                    style={styles.image}
                    onLoad={() => setMapState('loaded')}
                    onError={() => setMapState('broken')}
                    accessibilityIgnoresInvertColors
                  />
                  {mapState === 'loading' && <Skeleton width="100%" height="100%" style={styles.imageSkeleton} />}
                </>
              ) : (
                <View style={styles.imageFallback}>
                  <MapPinOff size={20} color={colors.textMuted} strokeWidth={1.75} />
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>
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
    paddingBottom: space[12],
  },
  imageBox: {
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
    fontSize: fontSize.xl,
    color: colors.text,
    fontWeight: '500',
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
});
