import { useState } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';

// design-spec.md T3: "press `scale(.97)` at 120ms, suppressed under
// prefers-reduced-motion" — shared by the category pill row and the
// subtype rail chips (2 real call sites, the reuse bar this repo already
// applies elsewhere for a dedicated hook, e.g. useFocusable/useNearbyLocation).
// `useState`'s lazy initializer (not `useRef`), matching FilterSheet/
// ScopeSheet's own `Animated.Value` convention — react-hooks/refs flags
// reading a ref's `.current` during render, and a plain state value sidesteps
// that read entirely.
export function usePressScale() {
  const [scale] = useState(() => new Animated.Value(1));

  function animateTo(value: number) {
    AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (reduceMotion) {
        scale.setValue(value);
        return;
      }
      Animated.timing(scale, { toValue: value, duration: 120, useNativeDriver: true }).start();
    });
  }

  return {
    scale,
    onPressIn: () => animateTo(0.97),
    onPressOut: () => animateTo(1),
  };
}
