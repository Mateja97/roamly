import { Animated } from 'react-native';
import { FilterChip } from '../../components/FilterChip';
import { usePressScale } from '../../hooks/usePressScale';

// design-spec.md T3: "press scale(.97) at 120ms, suppressed under
// prefers-reduced-motion" layered on top of FilterChip's own color
// feedback. Shared by CategoryRow and RatingRow (2 real call sites — the
// same reuse bar usePressScale's own comment already applies).
export function SegmentChip({
  label,
  accessibilityLabel,
  selected,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const press = usePressScale();
  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <FilterChip
        variant="segment"
        label={label}
        accessibilityLabel={accessibilityLabel}
        selected={selected}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
      />
    </Animated.View>
  );
}
