import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { classifyField } from './fieldKind';
import type { FactChip } from './activityDetailConfig';

type FactStripProps = { fields: FactChip[] };

const MAX_CHIPS = 3;

// design-spec.md's "Stat grid" slot (§B4): the exact fix for the production
// bug — every chip value passes through `classifyField('scalar', …)` before
// it ever reaches a `<Text>`, so a leaked full sentence/placeholder is
// dropped here rather than rendered into a tile sized for a scalar.
//
// Exported so T5's composition layer can classify+degrade *before* deciding
// what to hand the meta line: the spec's degradation rule folds a single
// surviving value into the meta line rather than a 1-cell grid, and this
// component only owns the "am I a 2/3-column grid or nothing" half of that
// — it has no meta line to fold into.
export function classifyFactChips(fields: FactChip[]): FactChip[] {
  return fields
    .map((field) => {
      const value = classifyField('scalar', field.value);
      return value ? { ...field, value } : undefined;
    })
    .filter((field): field is FactChip => field !== undefined)
    .slice(0, MAX_CHIPS);
}

// 3 valid values -> 3 columns, 2 -> 2 columns, 1 -> folds into the meta line
// (grid itself omits — see `classifyFactChips` above), 0 -> omits.
export function FactStrip({ fields }: FactStripProps) {
  const chips = classifyFactChips(fields);
  if (chips.length < 2) return null;

  return (
    <View style={styles.row}>
      {chips.map((field) => (
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
