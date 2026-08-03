import { useEffect, useRef } from 'react';
import { Animated, ScrollView, StyleSheet, View } from 'react-native';
import { EdgeFade } from '../../components/EdgeFade';
import { FilterChip } from '../../components/FilterChip';
import { usePressScale } from '../../hooks/usePressScale';
import { space } from '../../theme/tokens';
import { CATEGORY_LABELS } from './filters';
import type { Category } from './types';

type CategoryRowProps = {
  order: Category[];
  selected: Category[];
  onToggle: (category: Category) => void;
  onClearAll: () => void;
};

// design-spec.md T3: the relocated CATEGORY_OPTIONS/"All" row — `order` is
// already computed (categoryOrder.ts, recomputed by the caller on focus
// only) and selection never feeds back into it, which is what keeps
// "selecting a category must not reorder the row" true by construction:
// this component has no way to reorder based on `selected` even if it
// wanted to.
export function CategoryRow({ order, selected, onToggle, onClearAll }: CategoryRowProps) {
  const scrollRef = useRef<ScrollView>(null);
  // design-spec.md T3: "preserve scroll offset across a selection, reset to
  // 0 only when the order itself changes (time bucket or traveler mode)."
  // Selecting a pill never touches `order` (see categoryOrder.ts's own
  // purity), so this effect only fires on a genuine reorder, never a tap.
  const orderKey = order.join(',');
  useEffect(() => {
    scrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [orderKey]);

  return (
    <View style={styles.container}>
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <PressScaleChip
          label="All"
          accessibilityLabel="All categories"
          selected={selected.length === 0}
          onPress={() => {
            if (selected.length === 0) return; // re-tapping an already-active All is a no-op
            onClearAll();
          }}
        />
        {order.map((category) => (
          <PressScaleChip
            key={category}
            label={CATEGORY_LABELS[category]}
            selected={selected.includes(category)}
            onPress={() => onToggle(category)}
          />
        ))}
      </ScrollView>
      <EdgeFade />
    </View>
  );
}

// design-spec.md T3: "press scale(.97) at 120ms, suppressed under
// prefers-reduced-motion" layered on top of FilterChip's own color
// feedback — shared with SubtypeRail's chips.
function PressScaleChip({
  label,
  accessibilityLabel,
  selected,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const press = usePressScale();
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <FilterChip
        variant="segment"
        label={label}
        accessibilityLabel={accessibilityLabel}
        selected={selected}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  row: {
    flexDirection: 'row',
    gap: space[2],
    paddingRight: 30,
  },
});
