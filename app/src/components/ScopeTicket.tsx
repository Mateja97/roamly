import { useState } from 'react';
import type { ComponentType } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight } from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import { Spinner } from './Spinner';
import { colors, fontSize, radius, space } from '../theme/tokens';

type ScopeTicketProps = {
  icon: ComponentType<LucideProps>;
  title: string;
  hint: string;
  /** Single-select across the two tickets — the caller decides which one is
   * active; there's no local toggle state here. */
  selected: boolean;
  /** In-flight (device location resolving) — keep live colors, no gray. */
  busy?: boolean;
  reduceMotion?: boolean;
  accessibilityLabel: string;
  onPress: () => void;
};

const STUB_WIDTH = 78;
const NOTCH_SIZE = 16;
const GO_BUTTON_SIZE = 40;

// DESIGN_STANDARDS.md's "Scope ticket (nearby / anywhere)" recipe: a
// horizontal boarding-pass card (stub | body | go-button). The whole card
// is one tap target/one accessible button; tapping either ticket sets the
// scope and advances immediately, so "selected" doubles as both the
// resting emphasis on the default (Nearby) and the press/active feedback
// (see ScopePickerScreen).
export function ScopeTicket({
  icon: Icon,
  title,
  hint,
  selected,
  busy = false,
  reduceMotion = false,
  accessibilityLabel,
  onPress,
}: ScopeTicketProps) {
  const [focused, setFocused] = useState(false);
  // The 2px selected border IS the focus indicator — only add it for focus
  // on an otherwise-unselected card (the selected card already has it).
  const showFocusBorder = focused && !selected;

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy }}
      style={[styles.card, selected ? styles.cardSelected : styles.cardUnselected, showFocusBorder && styles.cardFocused]}
    >
      <LinearGradient
        colors={colors.surfaceGradient}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {selected && (
        // ponytail: expo-linear-gradient only does linear gradients, not the
        // spec's radial ellipse — a top-fade linear stand-in reads close
        // enough for a faint inner glow; swap for a real radial if a native
        // radial-gradient lib is ever added for a stronger need.
        <LinearGradient
          colors={[colors.glow, 'transparent']}
          start={{ x: 0.3, y: 0 }}
          end={{ x: 0.3, y: 0.65 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}

      <View style={styles.notchTop} />
      <View style={styles.notchBottom} />

      <View style={styles.stub} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon size={28} color={colors.primary} strokeWidth={1.75} />
      </View>

      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>

      <View style={styles.goButtonWrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View testID="scope-ticket-go-circle" style={[styles.goCircle, selected ? styles.goCircleSelected : styles.goCircleUnselected]}>
          {busy && !reduceMotion ? (
            <Spinner />
          ) : (
            <ArrowRight size={18} color={selected ? colors.ink : colors.primary} strokeWidth={2.4} />
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: '100%',
    minHeight: 104,
    borderRadius: radius.lg,
    overflow: 'hidden',
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  cardUnselected: {
    borderWidth: 1,
    borderColor: colors.border,
    borderTopColor: colors.cardHighlight,
  },
  cardFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  notchTop: {
    position: 'absolute',
    left: STUB_WIDTH - NOTCH_SIZE / 2,
    top: -NOTCH_SIZE / 2,
    width: NOTCH_SIZE,
    height: NOTCH_SIZE,
    borderRadius: NOTCH_SIZE / 2,
    backgroundColor: colors.bg,
  },
  notchBottom: {
    position: 'absolute',
    left: STUB_WIDTH - NOTCH_SIZE / 2,
    bottom: -NOTCH_SIZE / 2,
    width: NOTCH_SIZE,
    height: NOTCH_SIZE,
    borderRadius: NOTCH_SIZE / 2,
    backgroundColor: colors.bg,
  },
  stub: {
    width: STUB_WIDTH,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(206,144,66,0.14)',
    borderRightWidth: 2,
    borderRightColor: colors.border,
    borderStyle: 'dashed',
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    gap: space[1],
    paddingVertical: space[4],
    paddingHorizontal: space[4],
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
  },
  hint: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  goButtonWrap: {
    justifyContent: 'center',
    paddingRight: space[6],
  },
  goCircle: {
    width: GO_BUTTON_SIZE,
    height: GO_BUTTON_SIZE,
    borderRadius: GO_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goCircleSelected: {
    backgroundColor: colors.primary,
  },
  goCircleUnselected: {
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
});
