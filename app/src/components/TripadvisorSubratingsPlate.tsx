import { StyleSheet, Text, View } from 'react-native';
import type { TripadvisorSubratings } from '../api/activities';
import { colors, fontSize, radius, space } from '../theme/tokens';

type TripadvisorSubratingsPlateProps = {
  subratings: TripadvisorSubratings | undefined;
};

const CELLS: { key: keyof TripadvisorSubratings; label: string }[] = [
  { key: 'food', label: 'Food' },
  { key: 'service', label: 'Service' },
  { key: 'value', label: 'Value' },
  { key: 'atmosphere', label: 'Atmosphere' },
];

// design-spec.md T4's "Partner attribution plate — Subratings grid
// placement": a second inset white plate below the aggregate rating lockup,
// a 2x2 grid of Food/Service/Value/Atmosphere. Compliance rule 02 forbids
// hand-drawing Tripadvisor's rating bubbles ourselves, and the Terra API
// returns no per-subrating `rating_image_url` (confirmed against T3's
// backend model) — so this renders the numeric 1-5 value as plain --ink
// text per cell rather than a redrawn bubble (design-spec.md's documented
// fallback: "a number is compliant, never draw substitute bubbles").
export function TripadvisorSubratingsPlate({ subratings }: TripadvisorSubratingsPlateProps) {
  const cells = CELLS.filter((c) => subratings?.[c.key] !== undefined);
  if (cells.length === 0) return null;

  return (
    <View style={styles.plate}>
      {cells.map((cell) => (
        <View key={cell.key} style={styles.cell}>
          <Text style={styles.name}>{cell.label}</Text>
          <Text style={styles.value}>{subratings![cell.key]!.toFixed(1)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    backgroundColor: colors.attributionPlate,
    borderRadius: radius.default,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: space[3],
    columnGap: space[4],
  },
  cell: {
    // ponytail: `flexBasis` + `flexWrap` gives 2 columns on a normal-width
    // screen; a true "collapse to 1 column at large dynamic-text sizes"
    // needs measuring rendered text width (no RN media-query primitive) —
    // out of scope here, add if a real overflow report comes in.
    flexBasis: '45%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  name: {
    fontSize: fontSize.sm,
    color: colors.ink,
  },
  value: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
});
