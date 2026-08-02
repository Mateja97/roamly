import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Clock } from 'lucide-react-native';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import type { TodayHoursRowData } from './activityDetailConfig';

type HoursRowProps = {
  data: TodayHoursRowData | undefined;
  onPress: () => void;
};

// design-spec.md's "Hours row" slot (§B3): one tappable disclosure row
// (status + today's range + chevron) opening the existing WeekHoursModal —
// relocated out of the stat grid entirely. Present only when structured
// `opening_hours` is usable — `data` is `todayHoursRow(activity)`, the same
// usability gate the caller already had (opening-hours T1), reused rather
// than reinvented.
export function HoursRow({ data, onPress }: HoursRowProps) {
  const focus = useFocusable();
  if (!data) return null;

  return (
    <Pressable
      onPress={onPress}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      accessibilityRole="button"
      accessibilityLabel="See full opening hours"
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
        focus.focused && styles.rowFocused,
      ]}
    >
      <Clock size={18} color={colors.primary} strokeWidth={1.75} />
      <View style={styles.textGroup}>
        {/* Closed reads muted, never --error — closed is not an error, per
            the rule this app already applies to the meta-row status item. */}
        <Text style={data.status.isOpen ? styles.statusOpen : styles.statusClosed}>
          {data.status.text}
        </Text>
        <Text style={styles.hours}>{data.hours}</Text>
      </View>
      <ChevronRight size={16} color={colors.textMuted} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.default,
    padding: space[3],
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  rowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  rowFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  textGroup: {
    flex: 1,
    minWidth: 0,
  },
  statusOpen: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.success,
  },
  statusClosed: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textMuted,
  },
  hours: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginTop: 1,
  },
});
