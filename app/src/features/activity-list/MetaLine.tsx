import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { classifyField } from './fieldKind';

export type StatusChip = { kind: 'status'; text: string; isOpen: boolean };
export type LevelChip = { kind: 'level'; text: string };

const MAX_ITEMS = 4;

type MetaLineProps = {
  // Already-final values — rendered first, in order, never run through
  // `classifyField`. Two distinct reasons a value lands here rather than in
  // `items`: (1) app-computed/taxonomy-derived data (category noun, subtype,
  // distance/country) that was never generated content to begin with (a
  // country name over 18 chars was silently dropped by the scalar check it
  // was never meant to pass through), or (2)
  // generated content that already passed `classifyField` once upstream and
  // had a UI-only prefix (e.g. "from ") appended after that check — passing
  // it through `items` would re-classify the *prefixed* string and could
  // reject an otherwise-valid value on length alone. An array (not a
  // single `rawItem`) so category noun + subtype-from-slug can lead ahead
  // of distance/country without a second bypass prop.
  rawItems?: (string | undefined)[];
  items: (string | undefined)[];
  // Mutually exclusive per design-spec.md's "Meta line" slot — a category
  // shows at most one of the two.
  chip?: StatusChip | LevelChip;
};

// design-spec.md's "Meta line" slot (§B1): `·`-joined, each *generated*
// item a `scalar`, join-never-prefix so a single survivor renders alone
// with no dangling separator. Capped at 4 items per the spec's "≤4 items"
// contract (§B1). One optional trailing status/level chip, styled per
// DESIGN_STANDARDS.md's Scope indicator pill "gold-structure/cream-label"
// rule — border in the semantic color, label always cream `--text` (a 12px
// label in the semantic color itself would fail normal-text contrast on
// `--bg`/`--surface`, same reasoning as the Scope pill's gold-vs-cream call).
export function MetaLine({ rawItems = [], items, chip }: MetaLineProps) {
  const classified = items
    .map((item) => classifyField('scalar', item))
    .filter((item): item is string => Boolean(item));
  const allItems = [...rawItems, ...classified]
    .filter((item): item is string => Boolean(item))
    .slice(0, MAX_ITEMS);
  if (allItems.length === 0 && !chip) return null;

  return (
    <View style={styles.row}>
      {allItems.map((item, i) => (
        <View key={`${i}-${item}`} style={styles.itemGroup}>
          {i > 0 && <Text style={styles.separator}>·</Text>}
          <Text style={styles.text}>{item}</Text>
        </View>
      ))}
      {chip && (
        <View style={styles.itemGroup}>
          {allItems.length > 0 && <Text style={styles.separator}>·</Text>}
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
