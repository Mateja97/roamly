import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Clock } from 'lucide-react-native';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import type { TodayHoursRowData } from './activityDetailConfig';

type TodayHoursRowProps = { data: TodayHoursRowData; onPress: () => void };

// design-spec.md's Today hours row: a single full-width status line below
// the meta row, replacing the legacy Hours fact chip when structured
// `opening_hours` is usable. T2 wires the tap: the whole row is one 44×44+
// target opening the full-week modal, per design-spec.md's "so T2 can turn
// the whole row into one tap target without restyling".
export function TodayHoursRow({ data, onPress }: TodayHoursRowProps) {
  const focus = useFocusable();
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
      <Clock size={20} color={colors.primary} strokeWidth={1.75} />
      <View style={styles.textBlock}>
        <Text style={data.status.isOpen ? styles.statusOpen : styles.statusClosed}>
          {data.status.text}
        </Text>
        <Text style={styles.detail}>
          <Text style={styles.weekday}>{data.weekday}</Text>
          <Text style={styles.weekday}> · </Text>
          <Text style={styles.hours}>{data.hours}</Text>
        </Text>
      </View>
      <ChevronRight
        size={16}
        color={colors.textMuted}
        strokeWidth={1.75}
        style={styles.chevron}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
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
  textBlock: {
    flex: 1,
    marginLeft: space[3],
    marginRight: space[2],
    gap: space[1],
  },
  statusOpen: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.success,
  },
  statusClosed: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.textMuted,
  },
  detail: {
    fontSize: fontSize.sm,
  },
  weekday: {
    color: colors.textMuted,
  },
  hours: {
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  chevron: {
    alignSelf: 'flex-start',
  },
});
