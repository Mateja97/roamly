import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { colors } from '../theme/tokens';

// Inline 16px spinner per DESIGN_STANDARDS.md's Spinner recipe: a two-tone
// ring (--border track, --primary arc) built from a rotating bordered
// circle — no animation/icon library needed for a single spinning ring.
// prefers-reduced-motion: the caller omits this component entirely and
// relies on the static "…" already in its status label instead (see
// ScopePickerScreen's `reduceMotion` check and the Spinner recipe) — this
// component always renders the spinning ring.
export function Spinner() {
  // Animated.Value is a stable mutable instance, not a React ref — held in
  // state (lazy initializer) instead of useRef so the "no ref reads during
  // render" lint rule doesn't flag `.interpolate()` below.
  const [rotation] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [rotation]);

  const spin = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View
      style={[styles.ring, { transform: [{ rotate: spin }] }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

const SIZE = 16;

const styles = StyleSheet.create({
  ring: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 2,
    borderColor: colors.border,
    borderTopColor: colors.primary,
  },
});
