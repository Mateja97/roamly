import { ScrollView, StyleSheet, View } from 'react-native';
import { EdgeFade } from '../../components/EdgeFade';
import { space } from '../../theme/tokens';
import { RATING_OPTIONS, ratingAccessibilityLabel } from './filters';
import { SegmentChip } from './SegmentChip';
import type { RatingOption } from './types';

type RatingRowProps = {
  selected: RatingOption | null;
  onSelect: (value: RatingOption | null) => void;
};

// design-spec.md T2: like-for-like sibling of CategoryRow — same FilterChip
// segment variant (via the shared SegmentChip), same "exactly one chip
// always filled" single-select shape. Unlike CategoryRow's `order`,
// RATING_OPTIONS is static (design spec: "the order is static... the row's
// scroll offset is never reset"), so this needs no scroll-reset effect.
export function RatingRow({ selected, onSelect }: RatingRowProps) {
  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {RATING_OPTIONS.map((option) => (
          <SegmentChip
            key={option.label}
            label={option.label}
            accessibilityLabel={ratingAccessibilityLabel(option.value)}
            selected={selected === option.value}
            onPress={() => {
              if (selected === option.value) return; // re-tapping the already-selected chip is a no-op
              onSelect(option.value);
            }}
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
