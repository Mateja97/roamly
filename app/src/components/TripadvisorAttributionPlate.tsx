import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import type { TripadvisorAttribution } from '../api/activities';
import { colors, fontSize, radius, space } from '../theme/tokens';
import { TripadvisorLogo } from './TripadvisorLogo';

type TripadvisorAttributionPlateProps = {
  tripadvisor: TripadvisorAttribution;
  /** `card` = full-bleed band inside ActivityCard's body (§5a); `detail` = inset block on the detail screen (§5b). */
  variant: 'card' | 'detail';
};

const RATING_IMAGE_WIDTH = 55;
// Tripadvisor's rating-bubble strip images run roughly 5:1 wide — reserving
// this ratio at a fixed 55px width approximates the spec's "height auto,
// contentFit contain" without needing the real image's intrinsic size.
const RATING_IMAGE_ASPECT_RATIO = 5;

function reviewCountLabel(count: number): string {
  return `${count.toLocaleString('en-US')} reviews`;
}

// DESIGN_STANDARDS.md's "Partner attribution plate (Tripadvisor rating
// lockup)" recipe — sibling of PhotoAttributionCaption. Callers render this
// only for a Tripadvisor-sourced row (presence of `details.tripadvisor`);
// every other row keeps its unbranded gold-star rating treatment untouched.
// Single white-plate variant only — the app is single-theme (dark-only), so
// the partner's optional dark-mode bubble/logo-chip swap does not apply
// (design-spec.md's §5c reconciliation). The rating image is the API-hosted
// bubble (never a local copy/Roamly gold star); its width is reserved so a
// slow/broken load never reflows the count text beside it — plain
// expo-image load/broken behavior, no bespoke fallback UI (out of scope).
export function TripadvisorAttributionPlate({ tripadvisor, variant }: TripadvisorAttributionPlateProps) {
  const logoHeight = variant === 'card' ? 20 : 24;
  // design-spec.md T4: the ranking sentence ("#N of M restaurants...") and
  // the "Travellers' Choice 2026" badge are mock-only — the Terra API
  // returns no ranking/award data at all, so `ranking_text` never actually
  // populates (T3 confirmed). Context line is review count only now.
  const contextLine =
    variant === 'detail'
      ? `${reviewCountLabel(tripadvisor.review_count)} on Tripadvisor`
      : null;

  return (
    <View style={variant === 'card' ? styles.cardPlate : styles.detailPlate}>
      <View style={styles.row}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <TripadvisorLogo height={logoHeight} />
        </View>
        <Image
          testID="tripadvisor-rating-image"
          source={{ uri: tripadvisor.rating_image_url }}
          style={styles.ratingImage}
          contentFit="contain"
          accessibilityIgnoresInvertColors
        />
        {variant === 'card' && <Text style={styles.countText}>{reviewCountLabel(tripadvisor.review_count)}</Text>}
      </View>
      {contextLine && <Text style={styles.contextText}>{contextLine}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  // Full-bleed: bleeds past ActivityCard body's own `space[4]` horizontal
  // padding (clipped by the card's own overflow:hidden + radius-lg corners).
  // Vertical margin `space[1]` combines with the body's own flex `gap`
  // (space[2]) to net the spec's `space[3]` separation above/below.
  cardPlate: {
    backgroundColor: colors.attributionPlate,
    marginHorizontal: -space[4],
    marginVertical: space[1],
    paddingVertical: space[2],
    paddingHorizontal: space[4],
  },
  detailPlate: {
    backgroundColor: colors.attributionPlate,
    borderRadius: radius.default,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    gap: space[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  ratingImage: {
    width: RATING_IMAGE_WIDTH,
    aspectRatio: RATING_IMAGE_ASPECT_RATIO,
  },
  countText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  contextText: {
    fontSize: fontSize.xs,
    color: colors.ink,
    lineHeight: fontSize.xs * 1.5,
  },
});
