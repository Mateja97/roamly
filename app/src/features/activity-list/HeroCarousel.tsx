import { memo, useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ImageOff, Images } from 'lucide-react-native';
import type { ActivityPhoto } from '../../api/activities';
import { Skeleton } from '../../components/Skeleton';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { itemLayout } from './PhotoViewerModal';

const HERO_HEIGHT = 280;

type HeroCarouselProps = {
  photos: ActivityPhoto[];
  onBack: () => void;
  /** Opens PhotoViewerModal at the carousel's current page (continuity). */
  onOpenViewer: (index: number) => void;
  /** Reports the current page on swipe, so the parent's below-hero attribution caption (PhotoAttributionCaption) tracks it. */
  onIndexChange?: (index: number) => void;
};

// DESIGN_STANDARDS.md's Detail hero recipe: the full-bleed, swipeable
// sibling of the Fullscreen photo viewer. Reuses that viewer's paging
// mechanics verbatim (`itemLayout` + onMomentumScrollEnd index tracking) and
// its Dots convention — no new dependency, RN's own FlatList with
// pagingEnabled covers a single-row horizontal carousel. Owns the back
// control and the "Photos N" pill (both overlaid on the hero), so this is
// the one place the detail screen's back navigation and gallery entry live.
export function HeroCarousel({ photos, onBack, onOpenViewer, onIndexChange }: HeroCarouselProps) {
  const insets = useSafeAreaInsets();
  // T3: useSafeAreaFrame() measures document.documentElement.offsetWidth
  // exactly once, at SafeAreaProvider mount, with no resize listener (only
  // a safe-area-inset transitionend) — react-native-safe-area-context web's
  // NativeSafeAreaProvider.web.tsx. If the document isn't laid out yet at
  // that moment (background-tab restore, a 0-size webview, prerender), the
  // frame latches to width 0 forever, and pages never re-measure on resize
  // either. useWindowDimensions() reads window.innerWidth and subscribes to
  // the browser's resize event, so it neither latches at 0 nor goes stale.
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const backFocus = useFocusable();
  const pillFocus = useFocusable();
  const multi = photos.length >= 2;

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      setIndex(next);
      onIndexChange?.(next);
    },
    [width, onIndexChange],
  );

  const renderPage = useCallback(
    ({ item, index: i }: { item: ActivityPhoto; index: number }) => (
      <HeroPage uri={item.uri} width={width} index={i} />
    ),
    [width],
  );
  const keyExtractor = useCallback(
    (item: ActivityPhoto, i: number) => `${item.uri}-${i}`,
    [],
  );

  const current = photos[index];

  return (
    <View style={styles.heroBox}>
      {photos.length > 0 ? (
        <FlatList
          testID="activity-detail-hero-pager"
          style={styles.pagerList}
          data={photos}
          horizontal
          pagingEnabled
          scrollEnabled={multi}
          showsHorizontalScrollIndicator={false}
          keyExtractor={keyExtractor}
          renderItem={renderPage}
          getItemLayout={itemLayout(width)}
          onMomentumScrollEnd={onMomentumScrollEnd}
        />
      ) : (
        <View style={styles.pageFallback}>
          <ImageOff size={20} color={colors.textMuted} strokeWidth={1.75} />
        </View>
      )}

      {/* Renders on every hero photo — it's on the hero box, not per page —
          so it never shifts while paging. pointerEvents none so it never
          steals the pager's swipe gesture. */}
      <LinearGradient
        colors={colors.heroOverlayGradient.colors}
        locations={colors.heroOverlayGradient.locations}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <Pressable
        onPress={onBack}
        onFocus={backFocus.onFocus}
        onBlur={backFocus.onBlur}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={({ pressed }) => [
          styles.backButton,
          { top: insets.top + space[3] },
          pressed && styles.pressedDip,
          backFocus.focused && styles.focusRing,
        ]}
      >
        <ChevronLeft size={20} color={colors.text} strokeWidth={1.75} />
      </Pressable>

      {current?.caption && (
        <Text style={styles.caption} numberOfLines={1}>
          {current.caption}
        </Text>
      )}

      {multi && (
        <View
          style={styles.dots}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {photos.map((photo, i) => (
            <View
              key={`${photo.uri}-${i}`}
              style={i === index ? styles.dotActive : styles.dotInactive}
            />
          ))}
        </View>
      )}

      {multi && (
        <Pressable
          onPress={() => onOpenViewer(index)}
          onFocus={pillFocus.onFocus}
          onBlur={pillFocus.onBlur}
          accessibilityRole="button"
          accessibilityLabel={`View ${photos.length} photos`}
          style={({ pressed }) => [
            styles.pill,
            pressed && styles.pressedDip,
            pillFocus.focused && styles.focusRing,
          ]}
        >
          <Images size={16} color={colors.text} strokeWidth={1.75} />
          <Text style={styles.pillLabel}>{`Photos ${photos.length}`}</Text>
        </Pressable>
      )}
    </View>
  );
}

const HeroPage = memo(function HeroPage({
  uri,
  width,
  index,
}: {
  uri: string;
  width: number;
  index: number;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'broken'>(
    'loading',
  );
  return (
    <View testID={`activity-detail-hero-page-${index}`} style={[styles.page, { width }]}>
      {state !== 'broken' ? (
        <Image
          testID={`activity-detail-hero-image-${index}`}
          source={{ uri }}
          style={styles.pageImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          accessibilityIgnoresInvertColors
          onLoad={() => setState('loaded')}
          onError={() => setState('broken')}
        />
      ) : (
        <View style={styles.pageFallback}>
          <ImageOff size={20} color={colors.textMuted} strokeWidth={1.75} />
        </View>
      )}
      {state === 'loading' && (
        <Skeleton width="100%" height="100%" style={styles.pageSkeleton} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  heroBox: {
    width: '100%',
    height: HERO_HEIGHT,
    overflow: 'hidden',
    backgroundColor: colors.surfaceHover,
  },
  // react-native-web resolves a percentage height only against an ancestor
  // with a definite (non-auto) height. heroBox has one (HERO_HEIGHT), so
  // this resolves the pager itself to 280px, but FlatList/VirtualizedList's
  // own internal per-row wrapper divs (web-only, not part of this file) are
  // unstyled and stay height:auto — a `page: {height:'100%'}` cascading
  // through them would still collapse to 0. Using the numeric HERO_HEIGHT
  // directly on `page` (below) sidesteps that chain entirely. Native Yoga
  // doesn't have this quirk (it resolves the flex chain first), so
  // `pagerList` is a web-only style with no native-layout effect.
  pagerList: {
    height: '100%',
  },
  page: {
    height: HERO_HEIGHT,
  },
  pageImage: {
    width: '100%',
    height: '100%',
  },
  pageFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageSkeleton: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  backButton: {
    position: 'absolute',
    left: space[3],
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  pressedDip: {
    opacity: 0.7,
  },
  focusRing: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  caption: {
    position: 'absolute',
    left: space[3],
    right: space[16],
    bottom: space[3],
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.72, // 0.06em @ font-size-xs (12px)
    color: colors.text,
  },
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: space[3],
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: space[1],
  },
  dotActive: {
    width: 20,
    height: 7,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  dotInactive: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
    backgroundColor: colors.text,
    opacity: 0.4,
  },
  pill: {
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
  pillLabel: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
});
