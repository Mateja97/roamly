import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowUpRight } from 'lucide-react-native';
import type { FeaturedReview, TripadvisorAttribution } from '../../api/activities';
import { TripadvisorAttributionPlate } from '../../components/TripadvisorAttributionPlate';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';

type TripadvisorBlockProps = {
  tripadvisor: TripadvisorAttribution;
  featuredReview: FeaturedReview | undefined;
  ctaBusy: boolean;
  onOpenWebUrl: () => void;
};

// design-spec.md's T8 §5b: the contiguous Tripadvisor block on the detail
// screen — aggregate rating plate, an optional quoted featured review, a
// deep-link-out row to Tripadvisor's own review page, and a compliance
// disclaimer. The caller renders this in place of the screen's usual gold
// star + numeric rating, only for a Tripadvisor-sourced row, immediately
// after the meta row and before the per-category body sections.
export function TripadvisorBlock({ tripadvisor, featuredReview, ctaBusy, onOpenWebUrl }: TripadvisorBlockProps) {
  const linkFocus = useFocusable();

  return (
    <View style={styles.block}>
      <TripadvisorAttributionPlate tripadvisor={tripadvisor} variant="detail" />

      {featuredReview && (
        <View style={styles.reviewBlock}>
          <Text style={styles.reviewOverline}>A Tripadvisor traveler review</Text>
          <Text style={styles.reviewMeta}>{`Rated ${featuredReview.rating.toFixed(1)} · ${featuredReview.date}`}</Text>
          <Text style={styles.reviewQuote}>{`“${featuredReview.text}”`}</Text>
        </View>
      )}

      <Pressable
        onPress={onOpenWebUrl}
        onFocus={linkFocus.onFocus}
        onBlur={linkFocus.onBlur}
        disabled={ctaBusy}
        accessibilityRole="button"
        accessibilityLabel="Read all reviews on Tripadvisor"
        style={[styles.linkButton, linkFocus.focused && styles.linkButtonFocused]}
      >
        <Text style={styles.linkLabel}>Read all reviews on Tripadvisor</Text>
        <ArrowUpRight size={16} color={colors.text} strokeWidth={1.75} />
      </Pressable>

      <Text style={styles.disclaimer}>
        Ratings, reviews and photos for restaurants and bars are sourced from Tripadvisor and refreshed
        periodically. Roamly does not rate these places.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: space[4],
  },
  reviewBlock: {
    gap: space[2],
  },
  reviewOverline: {
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    // design-spec.md: letter-spacing 0.08em.
    letterSpacing: fontSize.xs * 0.08,
    color: colors.textMuted,
  },
  reviewMeta: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  reviewQuote: {
    fontSize: fontSize.md,
    color: colors.text,
    lineHeight: fontSize.md * 1.5,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.default,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  linkButtonFocused: {
    backgroundColor: colors.surfaceHover,
    borderColor: colors.primary,
  },
  linkLabel: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  disclaimer: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: fontSize.xs * 1.55,
  },
});
