import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, fontSize, space } from '../../theme/tokens';

type ReviewsSectionProps = {
  // The aggregate score header (score + "See all") is a *generic*
  // Roamly-drawn display — compliance rule 03 forbids it beside a
  // Tripadvisor row (whose own attribution plate already carries the
  // aggregate rating/bubble), so callers only ever pass `score` for the
  // Google case. Undefined omits the whole header, per design-spec.md's
  // "Reviews present, aggregate score absent" field-specific absence: cards
  // and the attribution slot still render alone.
  score?: number;
  reviewCount?: number;
  // ponytail: no caller passes this yet — the mockup's "See all" opens a
  // full reviews screen that doesn't exist in this app today. Wire it once
  // that screen (or an equivalent modal) lands; until then the control
  // itself correctly never renders (see `onSeeAll &&` below).
  onSeeAll?: () => void;
  // The provider-swapped attribution slot (§B10) — Google or Tripadvisor
  // plate composition, supplied by the caller. Neither compliance-critical
  // plate is touched by this component.
  attribution: ReactNode;
};

// design-spec.md's "Reviews" slot (§B10): one layout, two providers — score,
// up to 3 cards, "See all", and an attribution slot.
// ponytail: the spec's mockup also shows a per-star distribution bar chart,
// but neither Google's nor Tripadvisor's wire shape carries a rating
// histogram today (confirmed against api/activities.ts) — same "no venue
// has ever returned this" call TripadvisorAttribution.tsx already made for
// `attributes`/`recommended_visit_length`. Add the bars (and their prop)
// once a real field exists; a `number[]` nothing can ever populate is dead
// weight, not readiness.
export function ReviewsSection({ score, reviewCount, onSeeAll, attribution }: ReviewsSectionProps) {
  const hasScore = score !== undefined && reviewCount !== undefined;

  return (
    <View style={styles.section}>
      {hasScore && (
        <>
          <View style={styles.header}>
            <Text style={styles.overline}>Reviews</Text>
            {onSeeAll && (
              <Pressable onPress={onSeeAll} accessibilityRole="button">
                <Text style={styles.seeAll}>See all</Text>
              </Pressable>
            )}
          </View>
          <View style={styles.scoreBlock}>
            <Text style={styles.scoreNumber}>{score.toFixed(1)}</Text>
            <Text style={styles.scoreCount}>
              {`${reviewCount.toLocaleString()} ${reviewCount === 1 ? 'review' : 'reviews'}`}
            </Text>
          </View>
        </>
      )}
      {attribution}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: space[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  overline: {
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: fontSize.xs * 0.05,
    color: colors.textMuted,
    fontWeight: '600',
  },
  seeAll: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },
  scoreBlock: {
    alignItems: 'center',
  },
  scoreNumber: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.xxl,
    color: colors.primary,
    lineHeight: fontSize.xxl,
  },
  scoreCount: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: space[1],
  },
});
