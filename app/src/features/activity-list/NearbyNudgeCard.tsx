import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MapPin, X } from 'lucide-react-native';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';

type NearbyNudgeCardProps =
  | { variant: 'ask'; onOpenScope: () => void; onDismiss: () => void }
  | { variant: 'choose-city'; onOpenScope: () => void };

// design-spec.md T3: "Nearby nudge card... first list item when scope is
// unanchored Anywhere and location permission hasn't been asked... After an
// OS-level deny, swap for a quieter 'choose a city' nudge linking to the
// Scope sheet." Both variants open the same Scope sheet (T2) — the only
// difference is tone/dismissibility.
export function NearbyNudgeCard(props: NearbyNudgeCardProps) {
  const dismissFocus = useFocusable();
  const bodyFocus = useFocusable();

  if (props.variant === 'choose-city') {
    return (
      <Pressable
        onPress={props.onOpenScope}
        onFocus={bodyFocus.onFocus}
        onBlur={bodyFocus.onBlur}
        accessibilityRole="button"
        accessibilityLabel="Choose a city to explore"
        style={[styles.quietCard, bodyFocus.focused && styles.cardFocused]}
      >
        <MapPin size={16} color={colors.textMuted} strokeWidth={1.75} />
        <Text style={styles.quietText}>Choose a city to explore</Text>
      </Pressable>
    );
  }

  return (
    // Plain, non-accessible outer View — a Pressable "body" and the
    // Dismiss control are true siblings inside it (never one nested inside
    // the other's accessible subtree), same pattern ActivityCard already
    // uses for its own body-vs-attribution-link split: nesting one
    // accessible/role="button" element inside another lets a testing-
    // library/AT accessible-name computation bleed the inner element's
    // label into the outer's, matching queries that should be distinct.
    <View style={styles.card}>
      <Pressable
        onPress={props.onOpenScope}
        onFocus={bodyFocus.onFocus}
        onBlur={bodyFocus.onBlur}
        accessibilityRole="button"
        accessibilityLabel="See what's near you. Opens the scope sheet."
        style={[styles.body, bodyFocus.focused && styles.cardFocused]}
      >
        <View style={styles.iconWell}>
          <MapPin size={20} color={colors.primary} strokeWidth={1.75} />
        </View>
        <View style={styles.textColumn}>
          <Text style={styles.title}>See what&apos;s near you</Text>
          <Text style={styles.hint}>Turn on location for picks close to where you are right now.</Text>
        </View>
      </Pressable>
      <Pressable
        onPress={props.onDismiss}
        onFocus={dismissFocus.onFocus}
        onBlur={dismissFocus.onBlur}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={[styles.dismissButton, dismissFocus.focused && styles.dismissButtonFocused]}
      >
        <X size={16} color={colors.textMuted} strokeWidth={1.75} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopColor: colors.cardHighlight,
    borderRadius: radius.lg,
    paddingVertical: space[3],
    paddingLeft: space[3],
  },
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    borderRadius: radius.default,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  cardFocused: {
    backgroundColor: colors.surfaceHover,
  },
  iconWell: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: 'rgba(206,144,66,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    flex: 1,
    gap: space[1],
  },
  title: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  hint: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: fontSize.sm * 1.4,
  },
  dismissButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  dismissButtonFocused: {
    backgroundColor: colors.surfaceHover,
    borderRadius: radius.default,
  },
  quietCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.default,
    paddingHorizontal: space[3],
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  quietText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
});
