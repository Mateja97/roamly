import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MapPin, Phone } from 'lucide-react-native';
import type { TripadvisorAttribution, TripadvisorReview } from '../../api/activities';
import { TripadvisorAttributionPlate } from '../../components/TripadvisorAttributionPlate';
import { TripadvisorSubratingsPlate } from '../../components/TripadvisorSubratingsPlate';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { TripadvisorReviewsCarousel } from './TripadvisorReviewsCarousel';

type TripadvisorBlockProps = {
  tripadvisor: TripadvisorAttribution;
  // Tripadvisor's own numeric rating (`Activity.rating` for a TA-sourced
  // row) — the wire-level `tripadvisor` object carries no rating field of
  // its own, so the caller threads it through from the parent Activity.
  rating: number;
  reviews: TripadvisorReview[];
  address: string | undefined;
  ctaBusy: boolean;
  onCallPhone: (phone: string) => void;
};

// design-spec.md's T8/T4 §5b: the contiguous Tripadvisor block on the detail
// screen — aggregate rating plate, subratings grid, a traveler-reviews
// carousel, address/phone facts rows. The caller renders this in place of
// the screen's usual gold star + numeric rating, only for a
// Tripadvisor-sourced row, immediately after the meta row and before the
// per-category body sections. The "Read all reviews on Tripadvisor" deep
// link + disclaimer are the *trailing* elements of the scrollable content
// (design-spec.md T4's Footer CTAs + disclaimer section) — the caller
// renders those itself, after the map, right before the pinned footer.
export function TripadvisorBlock({
  tripadvisor,
  rating,
  reviews,
  address,
  ctaBusy,
  onCallPhone,
}: TripadvisorBlockProps) {
  const phoneFocus = useFocusable();
  const phone = tripadvisor.phone;
  const showFacts = Boolean(address || phone);

  return (
    <View style={styles.block}>
      <TripadvisorAttributionPlate tripadvisor={tripadvisor} rating={rating} variant="detail" />

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
});
