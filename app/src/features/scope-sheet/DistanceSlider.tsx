import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { colors, fontSize } from '../../theme/tokens';
import { useFocusable } from '../../hooks/useFocusable';
import { DISTANCE_STOPS_KM, distanceAtIndex, distanceIndex } from './scopeDraft';
import { scopeSheetStyles } from './scopeSheetStyles';

// @react-native-community/slider's published typings don't expose a
// `thumbStyle`/`thumbSize` override that actually reaches its web renderer —
// 20 is that renderer's own fixed thumb size (`constants.THUMB_SIZE`), used
// here only to position the decorative ring, not to resize the real thumb.
const THUMB_SIZE = 20;
const RING_SIZE = THUMB_SIZE + 8;

// design-spec.md T1 / DESIGN_STANDARDS.md Slider "Stepped variant": the
// control's own min/max/step operate on the stop *index*, never the raw km
// value — that's what places seven uneven stops at equal spacing. The last
// index (one past DISTANCE_STOPS_KM's own indices) is the open-ended "Any"
// stop, maps to maxDistanceKm: null.
const ANY_INDEX = DISTANCE_STOPS_KM.length;
const STOP_LABELS = [...DISTANCE_STOPS_KM.map(String), 'Any'];

export function DistanceSlider({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  const index = distanceIndex(value);
  const isAny = index === ANY_INDEX;

  const [dragging, setDragging] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const focus = useFocusable();
  const showRing = (dragging || focus.focused) && trackWidth > 0;
  const fraction = index / ANY_INDEX;
  const thumbCenter = THUMB_SIZE / 2 + fraction * (trackWidth - THUMB_SIZE);

  return (
    <View style={scopeSheetStyles.section}>
      <View style={scopeSheetStyles.labelRow}>
        <Text style={scopeSheetStyles.sectionLabel}>Max distance</Text>
        <Text style={styles.distanceValue}>{isAny ? 'Any distance' : `Within ${DISTANCE_STOPS_KM[index]} km`}</Text>
      </View>
      <View onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={ANY_INDEX}
          step={1}
          value={index}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.primary}
          onValueChange={(nextIndex) => onChange(distanceAtIndex(nextIndex))}
          onSlidingStart={() => setDragging(true)}
          onSlidingComplete={() => setDragging(false)}
          onFocus={focus.onFocus}
          onBlur={focus.onBlur}
          accessibilityLabel="Max distance"
          accessibilityValue={{ text: isAny ? 'Any distance' : `${DISTANCE_STOPS_KM[index]} kilometres` }}
        />
        {showRing && <View pointerEvents="none" style={[styles.sliderRing, { left: thumbCenter - RING_SIZE / 2 }]} />}
      </View>
      <View style={styles.stopLabelsRow}>
        {STOP_LABELS.map((label) => (
          <Text key={label} style={styles.stopLabel}>
            {label}
          </Text>
        ))}
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
  stopLabelsRow: {
    flexDirection: 'row',
  },
  stopLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
});
