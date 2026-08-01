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

// DESIGN_STANDARDS.md's Filter chip "Segmented (single-select, filled)"
// variant: an always-one-active list-screen quick-filter row (e.g. the
// activities-list category shortcut row). Filled-vs-outlined is the
// non-color selection cue (no `Check` icon) — distinct from the `select`
// variant's border+Check multi-select sheet treatment.
type SegmentChipProps = {
  variant: 'segment';
  label: string;
  selected: boolean;
  onPress: () => void;
  // T4: overrides the derived `${label}, selected` accessible name — needed
  // for the header row's reset pill, whose visible "All" reads as
  // meaningless to AT out of context (design-spec.md T4).
  accessibilityLabel?: string;
};

type FilterChipProps = SelectChipProps | RemoveChipProps | SegmentChipProps;

// DESIGN_STANDARDS.md's Filter chip recipe: the interactive sibling of the
// non-interactive Badge/pill. Three jobs, one component: a select/deselect
// option inside the Filter bottom sheet, a removable active-filter chip on
// the list, and (T1) a segmented single-select quick-filter chip.
export function FilterChip(props: FilterChipProps) {
  const [focused, setFocused] = useState(false);
  const isSegment = props.variant === 'segment';
  const selected = props.variant !== 'remove' && props.selected;
  // Remove chips always show the full --text label (per the recipe); select
  // chips only step up to --text once selected. Segment chips own their
  // label color directly (see segmentLabel* below), so they opt out here.
  const useTextLabel = props.variant === 'select' ? selected : props.variant === 'remove';

  const baseLabel = (props.variant === 'segment' && props.accessibilityLabel) || props.label;
  const accessibilityLabel =
    props.variant === 'remove' ? `Remove ${props.label} filter` : `${baseLabel}${selected ? ', selected' : ''}`;

  return (
    <Pressable
      onPress={props.onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      // Segment chips render at a visible ~32px (matching frame `5a`), so the
      // 44x44 tap-target floor comes from hitSlop instead of the other
      // variants' minHeight: 44 box.
      hitSlop={isSegment ? { top: 6, bottom: 6 } : undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={props.variant !== 'remove' ? { selected } : undefined}
      style={({ pressed }) => [
        styles.chip,
        selected && props.variant === 'select' && styles.chipSelected,
        props.variant === 'remove' && styles.chipRemove,
        isSegment && styles.segmentChip,
        isSegment && (selected ? styles.segmentSelected : styles.segmentUnselected),
        isSegment && pressed && (selected ? styles.segmentSelectedPressed : styles.segmentUnselectedPressed),
        focused && (isSegment ? styles.segmentFocused : styles.chipFocused),
      ]}
    >
      {props.variant === 'select' && selected && <Check size={16} color={colors.primary} strokeWidth={1.75} />}
      <Text
        style={[
          styles.label,
          useTextLabel && styles.labelSelected,
          isSegment && (selected ? styles.segmentLabelSelected : styles.segmentLabelUnselected),
        ]}
      >
        {props.label}
      </Text>
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
  segmentChip: {
    minHeight: 32,
  },
  segmentSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  segmentSelectedPressed: {
    backgroundColor: colors.primaryActive,
    borderColor: colors.primaryActive,
  },
  segmentUnselected: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  segmentUnselectedPressed: {
    backgroundColor: colors.surfaceHover,
  },
  segmentFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  segmentLabelSelected: {
    color: colors.ink,
    fontWeight: '600',
  },
  segmentLabelUnselected: {
    color: colors.text,
  },
});
