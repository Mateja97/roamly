import { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { TripadvisorReview } from '../../api/activities';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { RATING_BUBBLE_ASPECT_RATIO, RATING_BUBBLE_WIDTH } from '../../theme/tripadvisorBubble';
import { formatReviewDate } from '../../utils/date';

type TripadvisorReviewsCarouselProps = {
  reviews: TripadvisorReview[];
};

const CARD_WIDTH_RATIO = 0.78; // design-spec.md: "~78% of the content width (~300px)".
const CARD_GAP = space[3];

// design-spec.md T4's "Tripadvisor review card" recipe + paged carousel: up
// to 3 white review cards, same paged-`FlatList` approach as the hero photo
// carousel (T2) and this app's own Fullscreen photo viewer — peeking-card
// snap via `snapToInterval` rather than `pagingEnabled` (each page is
// narrower than the screen here, unlike a full-bleed photo page).
//
// Each review's own `rating_image_url` (fix/tripadvisor-design-fidelity —
// real, per-review API-hosted bubble image, compliance rule 02) renders in
// place of the numeric rating when Tripadvisor supplied one; the numeric
// text is the fallback when it's absent for that specific review. The API
// returns no separate review title (only `{rating, date, text}`), so the
// quote is still the card's one body block.
export function TripadvisorReviewsCarousel({ reviews }: TripadvisorReviewsCarouselProps) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.round(width * CARD_WIDTH_RATIO);
  const snapInterval = cardWidth + CARD_GAP;
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<TripadvisorReview>>(null);
  const prevFocus = useFocusable();
  const nextFocus = useFocusable();

  const goTo = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(i, reviews.length - 1));
      setIndex(clamped);
      listRef.current?.scrollToOffset({ offset: clamped * snapInterval, animated: true });
    },
    [reviews.length, snapInterval],
  );

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const i = Math.round(e.nativeEvent.contentOffset.x / snapInterval);
      setIndex(Math.max(0, Math.min(i, reviews.length - 1)));
    },
    [snapInterval, reviews.length],
  );

  if (reviews.length === 0) return null;
  const multi = reviews.length > 1;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.overline}>Tripadvisor traveler reviews</Text>
        {multi && (
          <View style={styles.headerRight}>
            <Text style={styles.counter}>{`${index + 1} of ${reviews.length}`}</Text>
            <Pressable
              onPress={() => goTo(index - 1)}
              onFocus={prevFocus.onFocus}
              onBlur={prevFocus.onBlur}
              disabled={index === 0}
              accessibilityRole="button"
              accessibilityLabel="Previous review"
              accessibilityState={{ disabled: index === 0 }}
              style={({ pressed }) => [
                styles.navButton,
                index === 0 && styles.navButtonDisabled,
                pressed && index !== 0 && styles.navButtonPressed,
                prevFocus.focused && styles.navButtonFocused,
              ]}
            >
              <ChevronLeft size={16} color={colors.text} strokeWidth={1.75} />
            </Pressable>
            <Pressable
              onPress={() => goTo(index + 1)}
              onFocus={nextFocus.onFocus}
              onBlur={nextFocus.onBlur}
              disabled={index === reviews.length - 1}
              accessibilityRole="button"
              accessibilityLabel="Next review"
              accessibilityState={{ disabled: index === reviews.length - 1 }}
              style={({ pressed }) => [
                styles.navButton,
                index === reviews.length - 1 && styles.navButtonDisabled,
                pressed && index !== reviews.length - 1 && styles.navButtonPressed,
                nextFocus.focused && styles.navButtonFocused,
              ]}
            >
              <ChevronRight size={16} color={colors.text} strokeWidth={1.75} />
            </Pressable>
          </View>
        )}
      </View>

      <FlatList
        ref={listRef}
        data={reviews}
        horizontal
        scrollEnabled={multi}
        showsHorizontalScrollIndicator={false}
        snapToInterval={snapInterval}
        decelerationRate="fast"
        disableIntervalMomentum
        keyExtractor={(item, i) => `${item.date}-${i}`}
        renderItem={({ item }) => <ReviewCard review={item} width={cardWidth} />}
        ItemSeparatorComponent={() => <View style={{ width: CARD_GAP }} />}
        contentContainerStyle={styles.list}
        onMomentumScrollEnd={onMomentumScrollEnd}
      />

      {multi && (
        <View
          style={styles.dots}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {reviews.map((_, i) => (
            <View key={i} style={i === index ? styles.dotActive : styles.dotInactive} />
          ))}
        </View>
      )}
    </View>
  );
}

// ponytail: plain function, not React.memo — up to 3 stateless cards, no
// async work per card (unlike PhotoViewerModal's PhotoPage, which memoizes
// around its own image-load state).
function ReviewCard({ review, width }: { review: TripadvisorReview; width: number }) {
  const formattedDate = formatReviewDate(review.date);
  return (
    <View style={[styles.card, { width }]}>
      <View style={styles.cardTopRow}>
        {review.rating_image_url ? (
          <View accessible accessibilityLabel={`Rated ${review.rating.toFixed(1)}`}>
            <Image
              testID="review-rating-bubble"
              source={{ uri: review.rating_image_url }}
              style={styles.cardRatingImage}
              contentFit="contain"
              accessibilityIgnoresInvertColors
              importantForAccessibility="no"
            />
          </View>
        ) : (
          <Text style={styles.cardRating}>{`Rated ${review.rating.toFixed(1)}`}</Text>
        )}
        {formattedDate && <Text style={styles.cardDate}>{formattedDate}</Text>}
      </View>
      <Text style={styles.cardQuote}>{`“${review.text}”`}</Text>
      <Text style={styles.cardByline}>A Tripadvisor traveler review</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: space[3],
    // Bleeds past the title block's own `space[6]` horizontal padding so
    // the FlatList can span full width for the peeking-card effect; the
    // header row below reinstates the gutter with its own padding.
    marginHorizontal: -space[6],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[6],
  },
  overline: {
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: fontSize.xs * 0.08,
    color: colors.textMuted,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  counter: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  navButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.default,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  navButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  navButtonFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  navButtonDisabled: {
    opacity: 0.4,
  },
  list: {
    paddingLeft: space[6],
    paddingRight: space[6] - CARD_GAP,
  },
  card: {
    backgroundColor: colors.attributionPlate,
    borderRadius: radius.default,
    padding: space[4],
    gap: space[2],
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardRating: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  cardRatingImage: {
    width: RATING_BUBBLE_WIDTH,
    aspectRatio: RATING_BUBBLE_ASPECT_RATIO,
  },
  cardDate: {
    fontSize: fontSize.xs,
    color: colors.ink,
  },
  cardQuote: {
    fontSize: fontSize.md,
    color: colors.ink,
    lineHeight: fontSize.md * 1.5,
  },
  cardByline: {
    fontSize: fontSize.xs,
    color: colors.ink,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
    paddingHorizontal: space[6],
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
});
