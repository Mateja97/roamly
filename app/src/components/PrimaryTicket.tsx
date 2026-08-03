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

const PIN_WELL_SIZE = 44;
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
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    gap: space[3],
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
    backgroundColor: 'rgba(206,144,66,0.14)',
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
