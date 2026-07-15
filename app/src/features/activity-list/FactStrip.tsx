import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import type { FactChip } from './activityDetailConfig';

type FactStripProps = { fields: FactChip[] };

// design-spec.md's Fact strip recipe: 2-3 equal-flex stat chips. Whole strip
// omitted (renders nothing) when there are zero fields to show — per-field
// omission already happened upstream in activityDetailConfig's buildChips.
export function FactStrip({ fields }: FactStripProps) {
  if (fields.length === 0) return null;

  return (
    <View style={styles.row}>
      {fields.map((field) => (
        <View key={field.label} style={styles.chip}>
          <field.icon size={20} color={colors.primary} strokeWidth={1.75} />
          <Text style={styles.value}>{field.value}</Text>
          <Text style={styles.label}>{field.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space[3],
  },
  chip: {
    flex: 1,
    alignItems: 'center',
    gap: space[1],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.default,
    padding: space[3],
  },
  value: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  label: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
