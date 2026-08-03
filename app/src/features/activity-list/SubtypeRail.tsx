import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Sparkles } from 'lucide-react-native';
import { EdgeFade } from '../../components/EdgeFade';
import { usePressScale } from '../../hooks/usePressScale';
import { colors, fontSize, space } from '../../theme/tokens';
import { CATEGORY_OPTIONS, SUBCATEGORIES } from './filters';
import { SUBTYPE_ICONS } from './subtypeIcons';
import type { Category } from './types';

const STAGGER_MS = 34;
const CHIP_DURATION_MS = 260;
// design-spec.md T3: "14px radius" — a literal from the spec, not one of
// tokens.ts's radius steps (8/16/999).
const CHIP_RADIUS = 14;
// ScopeTicket's own pin-well tint literal, reused verbatim (not re-derived)
// for the selected chip's gold tint fill — same convention T2 followed.
const SELECTED_TINT = 'rgba(206,144,66,0.14)';

type SubtypeRailProps = {
  category: Category;
  counts: Record<string, number>;
  selectedSubtypes: string[];
  onToggle: (subtype: string) => void;
};

// design-spec.md T3 Decision 5: one rail per currently-selected category —
// the caller renders one of these per entry in `filters.categories`
// (CATEGORY_OPTIONS order), not just for a lone selection.
export function SubtypeRail({ category, counts, selectedSubtypes, onToggle }: SubtypeRailProps) {
  const label = CATEGORY_OPTIONS.find((o) => o.value === category)?.label ?? category;
  const subtypes = SUBCATEGORIES[category];

  return (
    <View style={styles.container}>
      <Text style={styles.railLabel} accessibilityRole="header">
        {label} subtypes
      </Text>
      <View style={styles.rowWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {subtypes.map((subtype, index) => (
            <SubtypeChip
              key={subtype.value}
              slug={subtype.value}
              label={subtype.label}
              count={counts[subtype.value] ?? 0}
              selected={selectedSubtypes.includes(subtype.value)}
              index={index}
              onPress={() => onToggle(subtype.value)}
            />
          ))}
        </ScrollView>
        <EdgeFade />
      </View>
    </View>
  );
}

function SubtypeChip({
  slug,
  label,
  count,
  selected,
  index,
  onPress,
}: {
  slug: string;
  label: string;
  count: number;
  selected: boolean;
  index: number;
  onPress: () => void;
}) {
  // Plain property access (not a `subtypeIcon(slug)` call) — a call
  // expression assigned to a capitalized variable trips the
  // react-hooks/static-components heuristic even though the underlying
  // value is a stable reference from a static lookup table either way;
  // FeedHeader's identical `const Icon = pill.icon` pattern isn't flagged.
  const Icon = SUBTYPE_ICONS[slug] ?? Sparkles;
  const press = usePressScale();
  const [entrance] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled) return;
      if (reduceMotion) {
        entrance.setValue(1);
        return;
      }
      timer = setTimeout(() => {
        Animated.timing(entrance, { toValue: 1, duration: CHIP_DURATION_MS, useNativeDriver: true }).start();
      }, index * STAGGER_MS);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entrance/index are stable per chip instance
  }, []);

  // A currently-selected chip stays interactive even if its live count
  // drops to 0 during a refetch/scope change — otherwise a user's own
  // selection could become permanently stuck with no way to deselect it
  // (the category pill and EmptyState's Clear filters would be the only
  // remaining escapes).
  const disabled = count === 0 && !selected;

  return (
    <Animated.View
      style={{
        opacity: entrance,
        transform: [
          { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
          { scale: press.scale },
        ],
      }}
    >
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ selected, disabled }}
        accessibilityLabel={`${label}, ${count} ${count === 1 ? 'result' : 'results'}${disabled ? ', unavailable' : ''}`}
        style={[styles.chip, selected && styles.chipSelected, disabled && styles.chipDisabled]}
      >
        {!selected && (
          <LinearGradient colors={colors.surfaceGradient} style={StyleSheet.absoluteFill} pointerEvents="none" />
        )}
        {/* Wrapped in a View — react-native-web gives a bare `<svg>` (the
            lucide icon) no `position`, so it stays in the "static" paint
            layer, below the absolutely-positioned gradient regardless of
            DOM order; a plain View defaults to `position:'relative'` (like
            RNW's own Text), promoting the icon into the same positioned
            layer so it paints above the gradient, per its later DOM order. */}
        <View>
          <Icon size={16} color={disabled ? colors.textDisabled : selected ? colors.primary : colors.textMuted} strokeWidth={1.75} />
        </View>
        <Text style={[styles.label, selected && styles.labelSelected, disabled && styles.labelDisabled]} numberOfLines={1}>
          {label} ({count})
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: space[3],
    gap: space[2],
  },
  railLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rowWrap: {
    position: 'relative',
  },
  row: {
    flexDirection: 'row',
    gap: space[2],
    paddingRight: 30,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: 44,
    borderRadius: CHIP_RADIUS,
    // Constant 2px across selected/unselected (colour-only change) — same
    // "never a bare hairline, never a width change" rule the category row
    // follows; a 1px->2px jump on select would reflow the chip by a pixel.
    borderWidth: 2,
    borderColor: colors.border,
    paddingHorizontal: space[3],
    overflow: 'hidden',
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  chipSelected: {
    borderColor: colors.primary,
    backgroundColor: SELECTED_TINT,
  },
  chipDisabled: {
    opacity: 0.45,
  },
  label: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  labelSelected: {
    color: colors.text,
    fontWeight: '600',
  },
  labelDisabled: {
    color: colors.textDisabled,
  },
});
