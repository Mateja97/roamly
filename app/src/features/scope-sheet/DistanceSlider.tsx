import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { colors, fontSize } from '../../theme/tokens';
import { useFocusable } from '../../hooks/useFocusable';
import { DISTANCE_STEP_KM, MAX_DISTANCE_KM, MIN_DISTANCE_KM } from './scopeDraft';
import { scopeSheetStyles } from './scopeSheetStyles';

// @react-native-community/slider's published typings don't expose a
// `thumbStyle`/`thumbSize` override that actually reaches its web renderer —
// 20 is that renderer's own fixed thumb size (`constants.THUMB_SIZE`), used
// here only to position the decorative ring, not to resize the real thumb.
const THUMB_SIZE = 20;
const RING_SIZE = THUMB_SIZE + 8;

// design-spec.md T2: one canonical 5-500km range, the top stop (500) itself
// rendering "No limit" — same sentinel-value mechanism as FilterSheet's
// DistanceSlider (a value beyond the "narrowed" range maps to
// maxDistanceKm: null), just with the sentinel being the labeled ceiling
// itself rather than one invisible step past it, per design-spec.md's exact
// "5-500km, 500 renders 'No limit'" wording.
export function DistanceSlider({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  const min = MIN_DISTANCE_KM;
  const max = MAX_DISTANCE_KM;
  const sliderValue = value ?? max;
  const isNoLimit = sliderValue >= max;

  const [dragging, setDragging] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const focus = useFocusable();
  const showRing = (dragging || focus.focused) && trackWidth > 0;
  const fraction = (sliderValue - min) / (max - min);
  const thumbCenter = THUMB_SIZE / 2 + fraction * (trackWidth - THUMB_SIZE);

  function handleValueChange(next: number) {
    onChange(next >= max ? null : next);
  }

  return (
    <View style={scopeSheetStyles.section}>
      <View style={scopeSheetStyles.labelRow}>
        <Text style={scopeSheetStyles.sectionLabel}>Max distance</Text>
        <Text style={styles.distanceValue}>{isNoLimit ? 'No limit' : `Within ${sliderValue} km`}</Text>
      </View>
      <View onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}>
        <Slider
          style={styles.slider}
          minimumValue={min}
          maximumValue={max}
          step={DISTANCE_STEP_KM}
          value={sliderValue}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.primary}
          onValueChange={handleValueChange}
          onSlidingStart={() => setDragging(true)}
          onSlidingComplete={() => setDragging(false)}
          onFocus={focus.onFocus}
          onBlur={focus.onBlur}
          accessibilityLabel="Max distance"
          accessibilityValue={{ text: isNoLimit ? 'No limit' : `${sliderValue} kilometres` }}
        />
        {showRing && <View pointerEvents="none" style={[styles.sliderRing, { left: thumbCenter - RING_SIZE / 2 }]} />}
      </View>
      <View style={styles.endLabelsRow}>
        <Text style={styles.endLabel}>{min} km</Text>
        <Text style={styles.endLabel}>No limit</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  distanceValue: {
    fontSize: fontSize.md,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  slider: {
    width: '100%',
    height: 44,
  },
  sliderRing: {
    position: 'absolute',
    top: '50%',
    marginTop: -RING_SIZE / 2,
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 2,
    borderColor: colors.text,
  },
  endLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  endLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
});
