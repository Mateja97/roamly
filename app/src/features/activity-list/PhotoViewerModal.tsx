import { memo, useCallback, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Share2,
  X,
} from 'lucide-react-native';
import type { ActivityPhoto } from '../../api/activities';
import { ErrorBanner } from '../../components/ErrorBanner';
import { PhotoAttributionCaption } from '../../components/PhotoAttributionCaption';
import { Skeleton } from '../../components/Skeleton';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { SHARE_FAILED_MESSAGE } from './useOSHandoff';

type PhotoViewerModalProps = {
  photos: ActivityPhoto[];
  activityTitle: string;
  /** T2: opens at the hero carousel's currently swiped-to page instead of
   * always 0 — continuity between the inline hero and this fullscreen
   * viewer. Defaults to 0 (unchanged behavior for other callers). */
  initialIndex?: number;
  onClose: () => void;
};

const THUMB_SIZE = 64;
const THUMB_GAP = space[2];
// design-spec.md T4: the caption+attribution band reserves a fixed band so
// paging never shifts the dots/thumbnail strip below it, even for a photo
// with neither a caption nor attribution — one caption line (~28px) plus
// PhotoAttributionCaption's own footprint (44px min-height when linked).
const CAPTION_BAND_MIN_HEIGHT = 80;

// Shared by both FlatLists below (fixed-width pager pages, fixed-width
// thumbnails) — giving each a getItemLayout means scrollToIndex never needs
// a measurement pass, so a chevron/thumbnail tap or a swipe always resolves
// synchronously instead of risking onScrollToIndexFailed. Exported: T2's
// inline hero carousel reuses this verbatim for its own paged FlatList
// (DESIGN_STANDARDS.md's Detail hero recipe — same paging mechanics).
export function itemLayout(size: number) {
  return (_data: ArrayLike<unknown> | null | undefined, i: number) => ({
    length: size,
    offset: size * i,
    index: i,
  });
}

export function PhotoViewerModal({
  photos,
  activityTitle,
  initialIndex,
  onClose,
}: PhotoViewerModalProps) {
  const insets = useSafeAreaInsets();
  // T3: same fix as HeroCarousel — useSafeAreaFrame() latches its width at
  // SafeAreaProvider mount and never re-measures on resize (see the comment
  // there). useWindowDimensions() stays live.
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex ?? 0);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const pagerRef = useRef<FlatList<ActivityPhoto>>(null);
  const thumbsRef = useRef<FlatList<ActivityPhoto>>(null);
  const closeFocus = useFocusable();
  const shareFocus = useFocusable();
  const prevFocus = useFocusable();
  const nextFocus = useFocusable();

  const scrollThumbsTo = useCallback((i: number) => {
    thumbsRef.current?.scrollToIndex({
      index: i,
      animated: true,
      viewPosition: 0.5,
    });
  }, []);

  const goTo = useCallback(
    (i: number) => {
      setIndex(i);
      pagerRef.current?.scrollToIndex({ index: i, animated: true });
      scrollThumbsTo(i);
    },
    [scrollThumbsTo],
  );

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const i = Math.round(e.nativeEvent.contentOffset.x / width);
      setIndex(i);
      scrollThumbsTo(i);
    },
    [width, scrollThumbsTo],
  );

  const renderPage = useCallback(
    ({ item, index: i }: { item: ActivityPhoto; index: number }) => (
      <PhotoPage uri={item.uri} width={width} index={i} />
    ),
    [width],
  );
  const pageKeyExtractor = useCallback(
    (item: ActivityPhoto, i: number) => `${item.uri}-${i}`,
    [],
  );

  const renderThumb = useCallback(
    ({ item, index: i }: { item: ActivityPhoto; index: number }) => (
      <Thumbnail
        uri={item.thumb_url}
        active={i === index}
        photoNumber={i + 1}
        onPress={() => goTo(i)}
      />
    ),
    [index, goTo],
  );
  const thumbKeyExtractor = useCallback(
    (item: ActivityPhoto, i: number) => `thumb-${item.uri}-${i}`,
    [],
  );

  // design-spec.md's Fullscreen photo viewer recipe only ever opens for ≥2
  // photos (the hero pill hides itself below that) — this guard is a cheap
  // defensive no-op rather than a real code path.
  if (photos.length < 2) return null;
  const current = photos[index];

  async function handleShare() {
    setShareBusy(true);
    setShareError(null);
    try {
      await Share.share({
        message: `${activityTitle}: ${current.uri}`,
        url: current.uri,
      });
    } catch {
      setShareError(SHARE_FAILED_MESSAGE);
    } finally {
      setShareBusy(false);
    }
  }

  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.screen}>
        <View style={[styles.topBar, { paddingTop: insets.top + space[3] }]}>
          <Pressable
            onPress={onClose}
            onFocus={closeFocus.onFocus}
            onBlur={closeFocus.onBlur}
            accessibilityRole="button"
            accessibilityLabel="Close photos"
            style={[
              styles.iconButton,
              closeFocus.focused && styles.iconButtonFocused,
            ]}
          >
            <X size={20} color={colors.text} strokeWidth={1.75} />
          </Pressable>
          <Text style={styles.counter}>{`${index + 1} / ${photos.length}`}</Text>
          <Pressable
            onPress={handleShare}
            onFocus={shareFocus.onFocus}
            onBlur={shareFocus.onBlur}
            disabled={shareBusy}
            accessibilityRole="button"
            accessibilityLabel="Share this photo"
            style={[
              styles.iconButton,
              shareFocus.focused && styles.iconButtonFocused,
            ]}
          >
            <Share2 size={20} color={colors.text} strokeWidth={1.75} />
          </Pressable>
        </View>

        <View style={styles.pagerBox}>
          <FlatList
            testID="photo-viewer-pager"
            ref={pagerRef}
            data={photos}
            horizontal
            pagingEnabled
            initialScrollIndex={index}
            showsHorizontalScrollIndicator={false}
            keyExtractor={pageKeyExtractor}
            renderItem={renderPage}
            getItemLayout={itemLayout(width)}
            onMomentumScrollEnd={onMomentumScrollEnd}
          />
          {index > 0 && (
            <Pressable
              onPress={() => goTo(index - 1)}
              onFocus={prevFocus.onFocus}
              onBlur={prevFocus.onBlur}
              accessibilityRole="button"
              accessibilityLabel="Previous photo"
              style={[
                styles.chevron,
                styles.chevronLeft,
                prevFocus.focused && styles.iconButtonFocused,
              ]}
            >
              <ChevronLeft size={24} color={colors.text} strokeWidth={1.75} />
            </Pressable>
          )}
          {index < photos.length - 1 && (
            <Pressable
              onPress={() => goTo(index + 1)}
              onFocus={nextFocus.onFocus}
              onBlur={nextFocus.onBlur}
              accessibilityRole="button"
              accessibilityLabel="Next photo"
              style={[
                styles.chevron,
                styles.chevronRight,
                nextFocus.focused && styles.iconButtonFocused,
              ]}
            >
              <ChevronRight size={24} color={colors.text} strokeWidth={1.75} />
            </Pressable>
          )}
        </View>

        <View style={styles.captionBand}>
          {current.caption ? (
            <Text style={styles.caption}>{current.caption}</Text>
          ) : null}
          <PhotoAttributionCaption
            attribution={current.attribution}
            horizontalInset={space[6]}
          />
        </View>

        {shareError && (
          <ErrorBanner
            message={shareError}
            onDismiss={() => setShareError(null)}
          />
        )}

        {/* design-spec.md: dots are a decorative echo of the counter (the
            precise, non-decorative position source) — hidden from AT so
            VoiceOver/TalkBack don't announce M redundant unlabeled dots. */}
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

        <FlatList
          ref={thumbsRef}
          data={photos}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={thumbKeyExtractor}
          renderItem={renderThumb}
          getItemLayout={itemLayout(THUMB_SIZE + THUMB_GAP)}
          contentContainerStyle={[
            styles.thumbStrip,
            { paddingBottom: space[6] + insets.bottom },
          ]}
        />
      </View>
    </Modal>
  );
}

const PhotoPage = memo(function PhotoPage({
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
    <View style={[styles.page, { width }]}>
      {state !== 'broken' ? (
        <Image
          testID={`photo-viewer-page-image-${index}`}
          source={{ uri }}
          style={styles.pageImage}
          contentFit="contain"
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

const Thumbnail = memo(function Thumbnail({
  uri,
  active,
  photoNumber,
  onPress,
}: {
  uri: string | undefined;
  active: boolean;
  photoNumber: number;
  onPress: () => void;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'broken'>(
    uri ? 'loading' : 'broken',
  );
  const focus = useFocusable();
  return (
    <Pressable
      onPress={onPress}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      accessibilityRole="button"
      accessibilityLabel={`Photo ${photoNumber}`}
      style={[
        styles.thumb,
        active ? styles.thumbActive : styles.thumbInactive,
        focus.focused && styles.thumbFocused,
      ]}
    >
      {uri && state !== 'broken' ? (
        <Image
          testID={`photo-viewer-thumb-image-${photoNumber}`}
          source={{ uri }}
          style={styles.thumbImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          accessibilityIgnoresInvertColors
          onLoad={() => setState('loaded')}
          onError={() => setState('broken')}
        />
      ) : (
        <View style={styles.thumbFallback}>
          <ImageOff size={14} color={colors.textMuted} strokeWidth={1.75} />
        </View>
      )}
      {uri && state === 'loading' && (
        <Skeleton width="100%" height="100%" style={styles.thumbSkeleton} />
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.photoViewerBg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[4],
    paddingBottom: space[2],
  },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.default,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  iconButtonFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  counter: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  pagerBox: {
    flex: 1,
  },
  page: {
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
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
  chevron: {
    position: 'absolute',
    top: '50%',
    marginTop: -22,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.default,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  chevronLeft: {
    left: space[2],
  },
  chevronRight: {
    right: space[2],
  },
  captionBand: {
    minHeight: CAPTION_BAND_MIN_HEIGHT,
    justifyContent: 'flex-end',
  },
  caption: {
    fontSize: fontSize.sm,
    color: colors.text,
    paddingHorizontal: space[6],
    paddingTop: space[2],
  },
  dots: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
    paddingVertical: space[2],
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
  thumbStrip: {
    flexDirection: 'row',
    gap: THUMB_GAP,
    paddingHorizontal: space[4],
    paddingTop: space[2],
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: radius.default,
    borderWidth: 2,
    overflow: 'hidden',
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  thumbActive: {
    borderColor: colors.primary,
    opacity: 1,
  },
  thumbInactive: {
    borderColor: 'transparent',
    opacity: 0.6,
  },
  thumbFocused: {
    borderColor: colors.primary,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHover,
  },
  thumbSkeleton: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
