import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { EdgeFade } from '../../components/EdgeFade';
import { space } from '../../theme/tokens';
import { CATEGORY_LABELS } from './filters';
import { SegmentChip } from './SegmentChip';
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
        <SegmentChip
          label="All"
          accessibilityLabel="All categories"
          selected={selected.length === 0}
          onPress={() => {
            if (selected.length === 0) return; // re-tapping an already-active All is a no-op
            onClearAll();
          }}
        />
        {order.map((category) => (
          <SegmentChip
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
