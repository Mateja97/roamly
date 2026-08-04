import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SearchX } from 'lucide-react-native';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, space } from '../../theme/tokens';
import { feedStateStyles } from './feedStateStyles';

export function EmptyState({ hasFilters, onClearFilters }: { hasFilters: boolean; onClearFilters: () => void }) {
  const focus = useFocusable();
  return (
    <View style={styles.emptyState}>
      <SearchX size={20} color={colors.textMuted} strokeWidth={1.75} />
      <Text style={styles.emptyTitle}>No activities match</Text>
      <Text style={styles.emptyHint}>
        {hasFilters ? 'Try removing a filter or widening your distance.' : 'Nothing here right now.'}
      </Text>
      {hasFilters && (
        <Pressable
          onPress={onClearFilters}
          onFocus={focus.onFocus}
          onBlur={focus.onBlur}
          accessibilityRole="button"
          accessibilityLabel="Clear filters"
          style={[feedStateStyles.secondaryButton, focus.focused && feedStateStyles.secondaryButtonFocused]}
        >
          <Text style={feedStateStyles.secondaryButtonLabel}>Clear filters</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    alignItems: 'center',
    paddingVertical: space[12],
    gap: space[3],
  },
  emptyTitle: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  emptyHint: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
