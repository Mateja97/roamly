import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, space } from '../../theme/tokens';

type DifficultyMeterProps = { difficulty: number };

const SEGMENTS = 5;
// No documented label set beyond design-spec.md's "Intermediate" example —
// a 5-point scale mirroring the 5 segments is the direct reading.
const LABELS = ['Beginner', 'Easy', 'Intermediate', 'Advanced', 'Expert'];

// DESIGN_STANDARDS.md's "Difficulty meter (segmented)" recipe — Sport only.
// Non-interactive, static; the filled count and the text label are
// redundant so the value is never color-only.
export function DifficultyMeter({ difficulty }: DifficultyMeterProps) {
  const level = Math.min(SEGMENTS, Math.max(1, Math.round(difficulty)));
  const readout = `${LABELS[level - 1]} · ${level}/${SEGMENTS}`;

  return (
    <View accessible accessibilityLabel={`Difficulty: ${readout}`}>
      <View style={styles.labelRow}>
        <Text style={styles.overline}>Difficulty</Text>
        <Text style={styles.level}>{readout}</Text>
      </View>
      <View style={styles.segments}>
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <View
            key={i}
            style={[styles.segment, i < level && styles.segmentFilled]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space[2],
  },
  overline: {
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: colors.textMuted,
  },
  level: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
  segments: {
    flexDirection: 'row',
    gap: space[2],
  },
  segment: {
    flex: 1,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.border,
  },
  segmentFilled: {
    backgroundColor: colors.primary,
  },
});
