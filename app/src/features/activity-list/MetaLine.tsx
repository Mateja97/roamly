import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { classifyField } from './fieldKind';

export type StatusChip = { kind: 'status'; text: string; isOpen: boolean };
export type LevelChip = { kind: 'level'; text: string };

type MetaLineProps = {
  items: (string | undefined)[];
  // Mutually exclusive per design-spec.md's "Meta line" slot — a category
  // shows at most one of the two.
  chip?: StatusChip | LevelChip;
};

// design-spec.md's "Meta line" slot (§B1): `·`-joined, each item a `scalar`,
// join-never-prefix so a single survivor renders alone with no dangling
// separator. One optional trailing status/level chip, styled per
// DESIGN_STANDARDS.md's Scope indicator pill "gold-structure/cream-label"
// rule — border in the semantic color, label always cream `--text` (a 12px
// label in the semantic color itself would fail normal-text contrast on
// `--bg`/`--surface`, same reasoning as the Scope pill's gold-vs-cream call).
export function MetaLine({ items, chip }: MetaLineProps) {
  const classified = items
    .map((item) => classifyField('scalar', item))
    .filter((item): item is string => Boolean(item));
  if (classified.length === 0 && !chip) return null;

  return (
    <View style={styles.row}>
      {classified.map((item, i) => (
        <View key={`${i}-${item}`} style={styles.itemGroup}>
          {i > 0 && <Text style={styles.separator}>·</Text>}
          <Text style={styles.text}>{item}</Text>
        </View>
      ))}
      {chip && (
        <View style={styles.itemGroup}>
          {classified.length > 0 && <Text style={styles.separator}>·</Text>}
          <MetaLineChip chip={chip} />
        </View>
      )}
    </View>
  );
}

function MetaLineChip({ chip }: { chip: StatusChip | LevelChip }) {
  // Closed reads muted, never `--error` — closed is not an error, per the
  // rule this app already applies elsewhere (ActivityDetailScreen's
  // pre-existing status text, DESIGN_STANDARDS.md's Badge/pill recipe).
  const borderColor =
    chip.kind === 'level' ? colors.primary : chip.kind === 'status' && chip.isOpen ? colors.success : colors.border;
  return (
    <View style={[styles.chip, { borderColor }]}>
      {chip.kind === 'status' && chip.isOpen && <View style={styles.dot} />}
      <Text style={styles.chipLabel}>{chip.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[1],
  },
  itemGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  separator: {
    fontSize: fontSize.sm,
    color: colors.textDisabled,
  },
  text: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    borderWidth: 1,
    borderRadius: radius.full,
    // .dc.html §B1's Open pill: `padding:2px 9px` — tighter than any
    // space[] step (nearest token pair rounds up to 4/8), and this exact
    // chip size doesn't reuse an existing named recipe, so the literal
    // mockup pixels win here rather than a rounded token.
    paddingVertical: 2,
    paddingHorizontal: 9,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.success,
  },
  chipLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.text,
  },
});
