import type { ComponentType } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Baby,
  Check,
  ChevronRight,
  CircleCheck,
  Coffee,
  Toilet,
  Trees,
  X,
} from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import type { UniqueSectionData } from './activityDetailConfig';

// design-spec.md T8 addendum #4: per-facility icon, keyword-matched
// case-insensitively against the facility label — first match wins.
// Unmapped labels keep the generic CircleCheck fallback (intended, not a
// bug).
const FACILITY_ICONS: [RegExp, ComponentType<LucideProps>][] = [
  [/toilet|restroom|\bwc\b/i, Toilet],
  [/stroller|pram/i, Baby],
  [/kiosk|caf[eé]|coffee|snack/i, Coffee],
  [/shade|shaded|tree/i, Trees],
];

function facilityIcon(label: string): ComponentType<LucideProps> {
  return FACILITY_ICONS.find(([re]) => re.test(label))?.[1] ?? CircleCheck;
}

// The 12px uppercase muted overline used for every UniqueSection heading —
// matches ProseBlock's "About" heading (fontSize.xs, uppercase, textMuted,
// 600). Exported so other screens compose a section using this same
// treatment (e.g. Tours' "Meeting point") without hand-copying the tokens.
export const sectionHeadingStyle: TextStyle = {
  fontSize: fontSize.xs,
  textTransform: 'uppercase',
  letterSpacing: fontSize.xs * 0.05,
  color: colors.textMuted,
  fontWeight: '600',
};

type UniqueSectionProps = { data: UniqueSectionData | undefined };

// design-spec.md's "Unique sections (five shapes)" — one reusable renderer
// dispatched by `data.shape`. Whole section omitted when its category has no
// data for it (the `undefined` case, decided upstream in activityDetailConfig).
export function UniqueSection({ data }: UniqueSectionProps) {
  if (!data) return null;
  // design-spec.md's degradation table: "List row, name absent → drop the
  // whole row." Filtered at render time (see below) since the upstream
  // caller that builds `dateblock` data doesn't defend against it.
  // 0 survivors omits the section and its heading entirely, same
  // as every other shape's "0 items" case.
  const isEmptyDateBlockList =
    data.shape === 'schedule' && data.density === 'dateblock' && data.rows.every((row) => !row.title?.trim());
  if (isEmptyDateBlockList) return null;

  return (
    <View style={styles.section}>
      {data.shape !== 'banner' && (
        <Text style={styles.heading}>{data.heading}</Text>
      )}

      {data.shape === 'pills' && (
        <View style={styles.pillsRow}>
          {/* ponytail: keyed by index — these are free-text values from
              `details` and can legitimately repeat (two "Espresso" rows),
              and the lists never reorder. */}
          {data.items.map((item, i) => (
            <View key={i} style={styles.pill}>
              <Text style={styles.pillLabel}>{item}</Text>
            </View>
          ))}
        </View>
      )}

      {data.shape === 'checklist' && (
        <View style={styles.checklist}>
          {data.items.map((item, i) => (
            <View
              key={i}
              style={styles.checkRow}
              // Polarity lives only in the icon glyph+color otherwise, which
              // assistive tech can't read — the two-polarity checklist
              // (Tours' `crossItems` present) needs an explicit accessible
              // name per row; the plain single-polarity checklist every
              // other category uses keeps its heading-carries-polarity
              // behavior unchanged (props below are no-ops there).
              accessible={data.crossItems !== undefined ? true : undefined}
              accessibilityLabel={data.crossItems !== undefined ? `Included: ${item}` : undefined}
            >
              <Check
                size={18}
                // design-import mockup's slot #8 "extended" note: the ✓/✗
                // pairing (Tours' `crossItems` present, even if empty) uses
                // semantic success-green so it reads against the ✗'s
                // error-coral; the plain single-polarity checklist every
                // other category uses (no `crossItems`) keeps its existing
                // gold bullet-style treatment, unchanged.
                color={data.crossItems !== undefined ? colors.success : colors.primary}
                strokeWidth={data.crossItems !== undefined ? 2.2 : 1.75}
                style={styles.checkIcon}
              />
              <Text style={styles.checkText}>{item}</Text>
            </View>
          ))}
          {/* design-import mockup's slot #8 "extended" note: the ✗ variant,
              for Tours & Experiences' what's-not-included list — every other
              checklist consumer never sets `crossItems`, so this simply
              never renders for them. */}
          {data.crossItems?.map((item, i) => (
            <View
              key={`x-${i}`}
              style={styles.checkRow}
              accessible
              accessibilityLabel={`Not included: ${item}`}
            >
              <X size={18} color={colors.error} strokeWidth={2.2} style={styles.checkIcon} />
              <Text style={styles.checkText}>{item}</Text>
            </View>
          ))}
        </View>
      )}

      {data.shape === 'icongrid' && (
        <View style={styles.grid}>
          {data.items.map((item, i) => {
            const Icon = facilityIcon(item);
            return (
              <View key={i} style={styles.gridCell}>
                <Icon
                  size={20}
                  color={colors.primary}
                  strokeWidth={1.75}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <Text style={styles.gridLabel}>{item}</Text>
              </View>
            );
          })}
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
            <Text style={styles.bannerOverline}>{data.heading}</Text>
            <Text style={styles.bannerTitle}>{data.title}</Text>
            {data.description && (
              <Text style={styles.bannerDescription}>{data.description}</Text>
            )}
          </View>
        </View>
      )}

      {data.shape === 'schedule' && data.density === 'compact' && (
        <View style={styles.compactContainer}>
          {data.rows.map((row, i) => (
            <View
              key={i}
              style={[styles.compactRow, i > 0 && styles.hairlineTop]}
            >
              {row.leadingStyle === 'number' ? (
                <View style={styles.compactLeadingBadge}>
                  <Text style={styles.compactLeadingBadgeText}>{row.leading}</Text>
                </View>
              ) : (
                <Text style={styles.compactLeading}>{row.leading}</Text>
              )}
              <Text style={styles.compactMain}>{row.main}</Text>
              {row.trailing ? (
                <Text style={styles.compactTrailingMuted}>{row.trailing}</Text>
              ) : null}
            </View>
          ))}
        </View>
      )}

      {data.shape === 'schedule' && data.density === 'dateblock' && (
        <View style={styles.dateBlockList}>
          {/* design-spec.md's List rows "name absent drops the row" rule,
              applied to this density's name-equivalent field (`title`) — an
              upcoming show with no title is a headless card, not a row. */}
          {data.rows
            .filter((row) => Boolean(row.title?.trim()))
            .map((row, i) => (
              <View key={i} style={styles.dateBlockCard}>
                <LinearGradient
                  colors={colors.surfaceGradient}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
                {row.date ? (
                  <View style={styles.dateBlockDate}>
                    {row.day ? (
                      <Text style={styles.dateBlockDay}>{row.day}</Text>
                    ) : null}
                    <Text style={styles.dateBlockNum} numberOfLines={1}>
                      {row.date}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.dateBlockBody}>
                  {/* T11: a scalar-valid but unparseable date (e.g. "TBA")
                      renders here instead of being crushed into the numeral
                      column above, which stays empty for this row. */}
                  {row.dateLabel ? (
                    <Text style={styles.dateBlockLabel}>{row.dateLabel}</Text>
                  ) : null}
                  <Text style={styles.dateBlockTitle}>{row.title}</Text>
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
  heading: sectionHeadingStyle,
  hairlineTop: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
  // Itinerary's numbered-stop leading treatment (mockup: 22px gold-bordered
  // circle) — replaces the wide time-sized text column above for rows
  // opted into it via `leadingStyle: 'number'`.
  compactLeadingBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  compactLeadingBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.primary,
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
  // T11: same muted-overline treatment as the structured `dateBlockDay` —
  // an unstructured fallback label reads the same, just in the row body
  // instead of the tight numeral column.
  dateBlockLabel: {
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  dateBlockTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
});
