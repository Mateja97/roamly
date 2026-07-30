import { Image } from 'expo-image';
import { Award } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import type { TripadvisorAttribution } from '../api/activities';
import { colors, fontSize, radius, space } from '../theme/tokens';
import { RATING_BUBBLE_ASPECT_RATIO, RATING_BUBBLE_WIDTH } from '../theme/tripadvisorBubble';
import { TripadvisorLogo } from './TripadvisorLogo';

type TripadvisorAttributionPlateProps = {
  tripadvisor: TripadvisorAttribution;
  // Tripadvisor's own numeric rating for this row — carried on `Activity.rating`
  // (never on the wire-level `TripadvisorAttribution`, which has no rating
  // field of its own; see api/activities.ts). Compliance rule 03 only forbids
  // a *Roamly*-drawn star/score next to a partner row — Tripadvisor's own
  // rating beside Tripadvisor's own bubbles/count is fine.
  rating: number;
  /** `card` = inset content-hugging pill inside ActivityCard's body (§5a); `detail` = inset block on the detail screen (§5b). */
  variant: 'card' | 'detail';
};

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
export function TripadvisorAttributionPlate({ tripadvisor, rating, variant }: TripadvisorAttributionPlateProps) {
  // §5a's card mock draws the logo at 15px, which conflicts with §5c
  // compliance rule 01 ("logo sits immediately left of every aggregate
  // bubble rating, at least 20px tall") — rule 01 wins, so the card logo
  // stays at 20px rather than shrinking to match the mock literally.
  const logoHeight = variant === 'card' ? 20 : 24;
  const ratingText = rating.toFixed(1);
  // §5b: the detail variant's context line carries the review count and,
  // when Tripadvisor returned one, the dated ranking sentence — rendered
  // verbatim (never reformatted/truncated, compliance rule 05's month+year
  // stamp is composed server-side). The card variant (§5a) never shows
  // ranking/award — count only, matching the mock.
  const contextLine =
    variant === 'detail'
      ? [`${reviewCountLabel(tripadvisor.review_count)} on Tripadvisor`, tripadvisor.ranking_text]
          .filter(Boolean)
          .join(' · ')
      : null;

  return (
    <View testID="tripadvisor-attribution-plate" style={variant === 'card' ? styles.cardPlate : styles.detailPlate}>
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
        {/* §5b: detail row is logo → bubbles → bold numeric rating; §5a's card
            row folds the same number into the count text ("4.5 · 1,204") —
            the rating never renders without its review count (rule 02). */}
        {variant === 'detail' && <Text style={styles.ratingNumber}>{ratingText}</Text>}
        {variant === 'card' && (
          <Text style={styles.countText}>{`${ratingText} · ${tripadvisor.review_count.toLocaleString('en-US')}`}</Text>
        )}
      </View>
      {contextLine && <Text style={styles.contextText}>{contextLine}</Text>}
      {/* §5b: Travelers' Choice badge — detail only, omitted when the
          location carries no award (compliance: never fabricated). */}
      {variant === 'detail' && tripadvisor.award && (
        <View style={styles.awardRow}>
          <Award size={13} color={colors.ink} strokeWidth={2} />
          <Text style={styles.awardText}>{`${tripadvisor.award.name} ${tripadvisor.award.year}`}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Inset pill (§5a) — content-hugging, not full-bleed: `alignSelf:
  // 'flex-start'` overrides the body's default `alignItems: 'stretch'` so
  // the plate sizes to its row instead of stretching to the card's width,
  // leaving the maroon body gutter visible on both sides. Padding
  // approximates the mock's 5/11/5/9 (top/right/bottom/left) with the
  // nearest spacing tokens — asymmetric because the logo's own whitespace
  // already covers part of the left inset.
  cardPlate: {
    backgroundColor: colors.attributionPlate,
    alignSelf: 'flex-start',
    borderRadius: radius.full,
    marginVertical: space[1],
    paddingVertical: space[1],
    paddingLeft: space[2],
    paddingRight: space[3],
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
    width: RATING_BUBBLE_WIDTH,
    aspectRatio: RATING_BUBBLE_ASPECT_RATIO,
  },
  countText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  // §5b: the detail plate's standalone numeric rating — bold, `--ink`, per
  // the design's logo → bubbles → "4.5" → context-line order.
  ratingNumber: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  contextText: {
    fontSize: fontSize.xs,
    color: colors.ink,
    lineHeight: fontSize.xs * 1.5,
  },
  awardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  awardText: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.ink,
  },
});
