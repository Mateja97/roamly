import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusable } from '../../hooks/useFocusable';
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
        <FactStripChip key={field.label} field={field} />
      ))}
    </View>
  );
}

// opening-hours T3: a chip carrying `onPress` (only ever the Hours chip,
// when structured opening_hours is usable) renders as a Pressable that
// reopens the T2 week modal — same `useFocusable` border-color-swap focus
// treatment as every other Pressable on this screen, same `styles.chip` box
// as its non-interactive siblings so the grid never shifts size.
function FactStripChip({ field }: { field: FactChip }) {
  const focus = useFocusable();
  const content = (
    <>
      <field.icon size={20} color={colors.primary} strokeWidth={1.75} />
      <Text style={styles.value}>{field.value}</Text>
      <Text style={styles.label}>{field.label}</Text>
    </>
  );

  if (!field.onPress) {
    return <View style={styles.chip}>{content}</View>;
  }

  return (
    <Pressable
      onPress={field.onPress}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      accessibilityRole="button"
      accessibilityLabel="See full opening hours"
      style={({ pressed }) => [
        styles.chip,
        pressed && styles.chipPressed,
        focus.focused && styles.chipFocused,
      ]}
    >
      {content}
    </Pressable>
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
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  chipPressed: {
    backgroundColor: colors.surfaceHover,
  },
  chipFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
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
