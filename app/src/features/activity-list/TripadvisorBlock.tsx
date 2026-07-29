import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowUpRight, MapPin, Phone } from 'lucide-react-native';
import type { TripadvisorAttribution, TripadvisorReview } from '../../api/activities';
import { TripadvisorAttributionPlate } from '../../components/TripadvisorAttributionPlate';
import { TripadvisorSubratingsPlate } from '../../components/TripadvisorSubratingsPlate';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { TripadvisorReviewsCarousel } from './TripadvisorReviewsCarousel';

type TripadvisorBlockProps = {
  tripadvisor: TripadvisorAttribution;
  reviews: TripadvisorReview[];
  address: string | undefined;
  ctaBusy: boolean;
  onOpenWebUrl: () => void;
  onCallPhone: (phone: string) => void;
};

// design-spec.md's T8/T4 §5b: the contiguous Tripadvisor block on the detail
// screen — aggregate rating plate, subratings grid, a traveler-reviews
// carousel, address/phone facts rows, a deep-link-out row to Tripadvisor's
// own review page, and a compliance disclaimer. The caller renders this in
// place of the screen's usual gold star + numeric rating, only for a
// Tripadvisor-sourced row, immediately after the meta row and before the
// per-category body sections.
export function TripadvisorBlock({
  tripadvisor,
  reviews,
  address,
  ctaBusy,
  onOpenWebUrl,
  onCallPhone,
}: TripadvisorBlockProps) {
  const linkFocus = useFocusable();
  const phoneFocus = useFocusable();
  const phone = tripadvisor.phone;
  const showFacts = Boolean(address || phone);

  return (
    <View style={styles.block}>
      <TripadvisorAttributionPlate tripadvisor={tripadvisor} variant="detail" />

      <TripadvisorSubratingsPlate subratings={tripadvisor.subratings} />

      <TripadvisorReviewsCarousel reviews={reviews} />

      {/* design-spec.md T4's Place-facts list: address (static) + phone
          (tel: link) rows, separated from the section above by a hairline —
          omitted entirely when both are absent (graceful degradation, no
          empty row). Hours already renders via the FactStrip section below. */}
      {showFacts && (
        <View style={styles.facts}>
          {address && (
            <View style={styles.factRow}>
              <MapPin size={20} color={colors.primary} strokeWidth={1.75} />
              <Text style={styles.factText}>{address}</Text>
            </View>
          )}
          {phone && (
            <Pressable
              onPress={() => onCallPhone(phone)}
              onFocus={phoneFocus.onFocus}
              onBlur={phoneFocus.onBlur}
              disabled={ctaBusy}
              accessibilityRole="link"
              accessibilityLabel={`Call ${phone}`}
              style={[
                styles.factRow,
                styles.phoneRow,
                phoneFocus.focused && styles.phoneRowFocused,
              ]}
            >
              <Phone size={20} color={colors.primary} strokeWidth={1.75} />
              <Text style={styles.phoneText}>{phone}</Text>
            </Pressable>
          )}
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
  facts: {
    gap: space[3],
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  factText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  // design-spec.md: "a 13.5px gold link on wine would fail AA, so the link
  // is --text cream with an underline" — the sanctioned link affordance
  // from the Photo attribution recipe, 44x44 target, focus/press feedback.
  phoneRow: {
    minHeight: 44,
    borderRadius: radius.default,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  phoneRowFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  phoneText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
    textDecorationLine: 'underline',
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
