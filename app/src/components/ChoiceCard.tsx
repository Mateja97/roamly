import { useState } from 'react';
import type { ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LucideProps } from 'lucide-react-native';
import { colors, fontSize, radius, space } from '../theme/tokens';

type ChoiceCardProps = {
  icon: ComponentType<LucideProps>;
  title: string;
  hint: string;
  onPress: () => void;
  /** Non-interactive but visually live (--primary border, no gray) — the
   * Nearby card's in-flight state per design-spec: "keep the card's rest
   * colors, don't drop to disabled gray, it's live, not unavailable." */
  busy?: boolean;
  accessoryRight?: React.ReactNode;
};

// DESIGN_STANDARDS.md "Choice card" recipe: --surface bg, gold top edge,
// press/focus/selected all resolve to the same --primary border swap (mobile
// has no separate hover state — see Mobile-specific).
export function ChoiceCard({
  icon: Icon,
  title,
  hint,
  onPress,
  busy = false,
  accessoryRight,
}: ChoiceCardProps) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${hint}`}
      accessibilityState={{ disabled: busy, busy }}
      style={({ pressed }) => [
        styles.card,
        (pressed || focused) && !busy && styles.cardActive,
        busy && styles.cardBusy,
      ]}
    >
      <Icon size={20} color={colors.primary} strokeWidth={1.75} />
      <View style={styles.textGroup}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      {accessoryRight}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 1,
    borderTopColor: colors.cardHighlight,
    borderRadius: radius.default,
    padding: space[6],
    minHeight: 44,
    // The card's own --primary border swap IS the focus indicator (see
    // DESIGN_STANDARDS.md's Accessibility section) — suppress the browser's
    // default focus outline on web so it doesn't double up. Chromium's
    // default outline-style is `auto` (a native ring that ignores width
    // alone), so outline-style must be set too, not just outline-width.
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  cardActive: {
    backgroundColor: colors.surfaceHover,
    borderColor: colors.primary,
  },
  cardBusy: {
    borderColor: colors.primary,
  },
  textGroup: {
    flex: 1,
    gap: space[1],
  },
  title: {
    fontSize: fontSize.lg,
    color: colors.text,
    fontWeight: '500',
  },
  hint: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
});
