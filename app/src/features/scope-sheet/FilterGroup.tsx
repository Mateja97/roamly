import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, space } from '../../theme/tokens';

export function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel} accessibilityRole="header">
        {label}
      </Text>
      <View style={styles.chipsRow}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: space[3],
  },
  groupLabel: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  // This group's own `group` style already supplies the label->chips gap
  // (space[3]) — no marginTop here, or it stacks on top of that gap (was
  // 24px total on Minimum rating vs FilterSheet's 12px for the identical
  // group).
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
});
