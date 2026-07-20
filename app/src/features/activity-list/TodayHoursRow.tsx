import { StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Clock } from 'lucide-react-native';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import type { TodayHoursRowData } from './activityDetailConfig';

type TodayHoursRowProps = { data: TodayHoursRowData };

// design-spec.md's Today hours row: a single full-width status line below
// the meta row, replacing the legacy Hours fact chip when structured
// `opening_hours` is usable. The trailing chevron is T2's tap affordance —
// presentational only here (no press handler, no accessibilityRole yet).
export function TodayHoursRow({ data }: TodayHoursRowProps) {
  return (
    <View style={styles.row}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.default,
    padding: space[3],
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
