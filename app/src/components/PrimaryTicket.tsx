import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowRight, MapPin } from 'lucide-react-native';
import { colors, fontSize, radius, space } from '../theme/tokens';

type PrimaryTicketProps = {
  title: string;
  subtitle: string;
  accessibilityLabel: string;
  onPress: () => void;
};

// ponytail: 36 (not the spec's 26px icon size, but not the original 44
// either) — snug enough around the 26px icon to read as a well, and the
// horizontal room it frees up (vs. 44) is what keeps the sub-label on one
// line at 375pt (review round 1, Important #4).
const PIN_WELL_SIZE = 36;
const GO_DISC_SIZE = 40;

// DESIGN_STANDARDS.md's "Primary ticket" Standard addition (Components):
// a welcome/splash-only CTA taking the ticket card's 16px radius instead of
// the standard pill-button shape. One per screen, splash surfaces only —
// see the standard Primary button (Buttons table) for every other CTA.
export function PrimaryTicket({ title, subtitle, accessibilityLabel, onPress }: PrimaryTicketProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.card,
        hovered && !pressed && styles.cardHovered,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.pinWell} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <MapPin size={26} color={colors.ink} strokeWidth={1.75} />
      </View>

      <View style={styles.divider} />

      <View style={styles.labelBlock}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      <View style={styles.goDisc} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ArrowRight size={18} color={colors.primary} strokeWidth={2.4} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    minHeight: 52,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    gap: space[2],
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  cardHovered: {
    backgroundColor: colors.primaryHover,
  },
  cardPressed: {
    backgroundColor: colors.primaryActive,
  },
  pinWell: {
    width: PIN_WELL_SIZE,
    height: PIN_WELL_SIZE,
    borderRadius: PIN_WELL_SIZE / 2,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    // The ScopeTicket stub's gold tint
    // (rgba(206,144,66,0.14)) was derived against a wine surface — on this
    // card's own gold --primary fill it's gold-on-gold and invisible. Ink
    // tint instead, so the well itself reads as a recess in the gold.
    backgroundColor: 'rgba(42,14,17,0.10)',
  },
  divider: {
    width: 0,
    height: 36,
    borderLeftWidth: 2,
    borderStyle: 'dashed',
    borderLeftColor: 'rgba(42,14,17,0.35)',
  },
  labelBlock: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
  },
  subtitle: {
    fontSize: 13.5,
    fontWeight: '400',
    lineHeight: 13.5 * 1.45,
    color: colors.ink,
  },
  goDisc: {
    width: GO_DISC_SIZE,
    height: GO_DISC_SIZE,
    borderRadius: GO_DISC_SIZE / 2,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
});
