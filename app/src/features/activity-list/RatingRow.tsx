import { ScrollView, StyleSheet, View } from 'react-native';
import { EdgeFade } from '../../components/EdgeFade';
import { space } from '../../theme/tokens';
import { RATING_OPTIONS } from './filters';
import { SegmentChip } from './SegmentChip';
import type { RatingOption } from './types';

// design-spec.md T2: visible labels ("Any", "4.0+") are too terse to stand
// alone for AT, same reasoning CategoryRow's "All" -> "All categories"
// override already follows.
const RATING_ACCESSIBILITY_LABELS: Record<string, string> = {
  Any: 'Any rating',
  '4.0+': 'Rated 4.0 and up',
  '4.5+': 'Rated 4.5 and up',
  '4.8+': 'Rated 4.8 and up',
};

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
            accessibilityLabel={RATING_ACCESSIBILITY_LABELS[option.label]}
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
