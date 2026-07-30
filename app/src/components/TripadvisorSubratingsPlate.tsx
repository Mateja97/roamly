import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import type { TripadvisorSubratings } from '../api/activities';
import { colors, fontSize, radius, space } from '../theme/tokens';
import { RATING_BUBBLE_ASPECT_RATIO, RATING_BUBBLE_WIDTH } from '../theme/tripadvisorBubble';

type TripadvisorSubratingsPlateProps = {
  subratings: TripadvisorSubratings | undefined;
};

const CELLS: { key: keyof TripadvisorSubratings; label: string }[] = [
  { key: 'food', label: 'Food' },
  { key: 'service', label: 'Service' },
  { key: 'value', label: 'Value' },
  { key: 'atmosphere', label: 'Atmosphere' },
];

// DESIGN_STANDARDS.md's "Partner attribution plate — Subratings grid
// placement": a second inset white plate below the aggregate rating lockup,
// a 2x2 grid of Food/Service/Value/Atmosphere. Each cell renders its own
// API-hosted `icon_url` bubble image (compliance rule 02: real asset, never
// redrawn/recolored) and falls back to the plain --ink numeric value only
// when that aspect carries no image URL — a number is compliant, a
// hand-drawn substitute bubble isn't. The image is decorative (excluded
// from the a11y tree); the cell's own accessibilityLabel carries the name +
// rating so nothing is lost for AT users when the image renders.
export function TripadvisorSubratingsPlate({ subratings }: TripadvisorSubratingsPlateProps) {
  const cells = CELLS.filter((c) => subratings?.[c.key] !== undefined);
  if (cells.length === 0) return null;

  return (
    <View style={styles.plate}>
      {cells.map((cell) => {
        const aspect = subratings![cell.key]!;
        return (
          <View
            key={cell.key}
            style={styles.cell}
            accessible
            accessibilityLabel={`${cell.label} rated ${aspect.rating.toFixed(1)}`}
          >
            <Text style={styles.name}>{cell.label}</Text>
            {aspect.icon_url ? (
              <Image
                testID={`subrating-bubble-${cell.key}`}
                source={{ uri: aspect.icon_url }}
                style={styles.bubble}
                contentFit="contain"
                accessibilityIgnoresInvertColors
                importantForAccessibility="no"
              />
            ) : (
              <Text style={styles.value}>{aspect.rating.toFixed(1)}</Text>
            )}
          </View>
        );
      })}
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
  bubble: {
    width: RATING_BUBBLE_WIDTH,
    aspectRatio: RATING_BUBBLE_ASPECT_RATIO,
  },
});
