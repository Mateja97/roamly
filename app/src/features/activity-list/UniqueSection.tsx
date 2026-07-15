import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, ChevronRight, CircleCheck, Info } from 'lucide-react-native';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import type { UniqueSectionData } from './activityDetailConfig';

type UniqueSectionProps = { data: UniqueSectionData | undefined };

// design-spec.md's "Unique sections (five shapes)" — one reusable renderer
// dispatched by `data.shape`. Whole section omitted when its category has no
// data for it (the `undefined` case, decided upstream in activityDetailConfig).
export function UniqueSection({ data }: UniqueSectionProps) {
  if (!data) return null;

  return (
    <View style={styles.section}>
      {data.shape !== 'banner' && (
        <Text style={styles.heading}>{data.heading}</Text>
      )}

      {data.shape === 'nameprice' && (
        <View>
          {data.items.map((item, i) => (
            <View
              key={item.name}
              style={[styles.nameRow, i > 0 && styles.hairlineTop]}
            >
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.rowPrice}>{item.price}</Text>
            </View>
          ))}
        </View>
      )}

      {data.shape === 'pills' && (
        <View style={styles.pillsRow}>
          {data.items.map((item) => (
            <View key={item} style={styles.pill}>
              <Text style={styles.pillLabel}>{item}</Text>
            </View>
          ))}
        </View>
      )}

      {data.shape === 'checklist' && (
        <View style={styles.checklist}>
          {data.items.map((item) => (
            <View key={item} style={styles.checkRow}>
              <Check
                size={18}
                color={colors.primary}
                strokeWidth={1.75}
                style={styles.checkIcon}
              />
              <Text style={styles.checkText}>{item}</Text>
            </View>
          ))}
        </View>
      )}

      {data.shape === 'icongrid' && (
        <View style={styles.grid}>
          {data.items.map((item) => (
            <View key={item} style={styles.gridCell}>
              <CircleCheck
                size={20}
                color={colors.primary}
                strokeWidth={1.75}
              />
              <Text style={styles.gridLabel}>{item}</Text>
            </View>
          ))}
        </View>
      )}

      {data.shape === 'banner' && (
        <View style={styles.banner}>
          <LinearGradient
            colors={colors.surfaceGradient}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.bannerAccent} />
          <View style={styles.bannerContent}>
            {data.attribution && (
              <Text style={styles.bannerAttribution}>{data.attribution}</Text>
            )}
            <Text style={styles.bannerOverline}>{data.heading}</Text>
            <Text style={styles.bannerTitle}>{data.title}</Text>
            {data.description && (
              <Text style={styles.bannerDescription}>{data.description}</Text>
            )}
          </View>
        </View>
      )}

      {data.shape === 'schedule' && data.density === 'compact' && (
        <View>
          <View style={styles.compactContainer}>
            {data.rows.map((row, i) => (
              <View
                key={i}
                style={[styles.compactRow, i > 0 && styles.hairlineTop]}
              >
                <Text style={styles.compactLeading}>{row.leading}</Text>
                <Text style={styles.compactMain}>{row.main}</Text>
                {row.trailing ? (
                  <Text
                    style={
                      row.trailingStyle === 'price'
                        ? styles.compactTrailingPrice
                        : styles.compactTrailingMuted
                    }
                  >
                    {row.trailing}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
          {data.note && (
            <View style={styles.note}>
              <Info size={14} color={colors.textMuted} strokeWidth={1.75} />
              <Text style={styles.noteText}>{data.note}</Text>
            </View>
          )}
        </View>
      )}

      {data.shape === 'schedule' && data.density === 'dateblock' && (
        <View style={styles.dateBlockList}>
          {data.rows.map((row, i) => (
            <View key={i} style={styles.dateBlockCard}>
              <LinearGradient
                colors={colors.surfaceGradient}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              <View style={styles.dateBlockDate}>
                {row.day ? (
                  <Text style={styles.dateBlockDay}>{row.day}</Text>
                ) : null}
                <Text style={styles.dateBlockNum}>{row.date}</Text>
              </View>
              <View style={styles.dateBlockBody}>
                <Text style={styles.dateBlockTitle}>{row.title}</Text>
                {row.subline ? (
                  <Text style={styles.dateBlockSubline}>{row.subline}</Text>
                ) : null}
              </View>
              <ChevronRight
                size={18}
                color={colors.primary}
                strokeWidth={1.75}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: space[3],
  },
  heading: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
  },
  // Shape A — name+price list
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: space[3],
  },
  hairlineTop: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowName: {
    fontSize: fontSize.sm,
    color: colors.text,
  },
  rowPrice: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  // Shape B — pill list
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  pill: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingVertical: space[2],
    paddingHorizontal: space[3],
  },
  pillLabel: {
    fontSize: fontSize.sm,
    color: colors.text,
  },
  // Shape C — checklist
  checklist: {
    gap: space[3],
  },
  checkRow: {
    flexDirection: 'row',
    gap: space[2],
  },
  checkIcon: {
    marginTop: 2,
    flexShrink: 0,
  },
  checkText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  // Shape D — icon grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[3],
  },
  gridCell: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 44,
    alignItems: 'center',
    gap: space[2],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space[4],
  },
  gridLabel: {
    fontSize: fontSize.sm,
    color: colors.text,
    textAlign: 'center',
  },
  // Shape E — accent banner
  banner: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderTopColor: colors.cardHighlight,
    borderRadius: radius.default,
  },
  bannerAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: colors.primary,
  },
  bannerContent: {
    padding: space[4],
    paddingLeft: space[4] + 3,
    gap: space[1],
  },
  bannerAttribution: {
    fontSize: fontSize.xs,
    fontStyle: 'italic',
    color: colors.textMuted,
    marginBottom: space[1],
  },
  bannerOverline: {
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: colors.textMuted,
  },
  bannerTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  bannerDescription: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  // Shape F — scheduled-items list (compact density)
  compactContainer: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.default,
    backgroundColor: colors.surface,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
  },
  compactLeading: {
    width: 52,
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  compactMain: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  compactTrailingMuted: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  compactTrailingPrice: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginTop: space[3],
  },
  noteText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  // Shape F — scheduled-items list (date-block density)
  dateBlockList: {
    gap: space[3],
  },
  dateBlockCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.default,
    padding: space[3],
  },
  dateBlockDate: {
    alignItems: 'center',
    width: 44,
  },
  dateBlockDay: {
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  dateBlockNum: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  dateBlockBody: {
    flex: 1,
    gap: space[1],
  },
  dateBlockTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  dateBlockSubline: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
});
