import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Check, X } from 'lucide-react-native';
import { colors, fontSize, radius, space } from '../theme/tokens';

type SelectChipProps = {
  variant: 'select';
  label: string;
  selected: boolean;
  onPress: () => void;
};

type RemoveChipProps = {
  variant: 'remove';
  label: string;
  onPress: () => void;
};

type FilterChipProps = SelectChipProps | RemoveChipProps;

// DESIGN_STANDARDS.md's Filter chip recipe: the interactive sibling of the
// non-interactive Badge/pill. Two jobs, one component: a select/deselect
// option inside the Filter bottom sheet, and a removable active-filter chip
// on the list.
export function FilterChip(props: FilterChipProps) {
  const [focused, setFocused] = useState(false);
  const selected = props.variant === 'select' && props.selected;
  // Remove chips always show the full --text label (per the recipe); select
  // chips only step up to --text once selected.
  const useTextLabel = selected || props.variant === 'remove';

  const accessibilityLabel =
    props.variant === 'remove'
      ? `Remove ${props.label} filter`
      : `${props.label}${selected ? ', selected' : ''}`;

  return (
    <Pressable
      onPress={props.onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={props.variant === 'select' ? { selected } : undefined}
      style={[styles.chip, selected && styles.chipSelected, props.variant === 'remove' && styles.chipRemove, focused && styles.chipFocused]}
    >
      {selected && <Check size={16} color={colors.primary} strokeWidth={1.75} />}
      <Text style={[styles.label, useTextLabel && styles.labelSelected]}>{props.label}</Text>
      {props.variant === 'remove' && <X size={16} color={colors.textMuted} strokeWidth={1.75} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    minHeight: 44,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    backgroundColor: 'transparent',
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  chipSelected: {
    backgroundColor: colors.surfaceHover,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  chipRemove: {
    backgroundColor: colors.surfaceHover,
    borderColor: colors.border,
  },
  chipFocused: {
    borderColor: colors.primary,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.textMuted,
  },
  labelSelected: {
    color: colors.text,
  },
});
