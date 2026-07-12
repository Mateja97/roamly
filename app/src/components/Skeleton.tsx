import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, type DimensionValue, type ViewStyle } from 'react-native';
import { colors, radius } from '../theme/tokens';

type SkeletonProps = {
  width: DimensionValue;
  height: DimensionValue;
  style?: ViewStyle;
};

// DESIGN_STANDARDS.md's Skeleton loader recipe: --surface-hover block,
// opacity 0.5→1 pulse, 1.2s ease-in-out infinite alternate;
// prefers-reduced-motion: static at opacity 0.7.
export function Skeleton({ width, height, style }: SkeletonProps) {
  const [opacity] = useState(() => new Animated.Value(0.5));
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(0.7);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduceMotion]);

  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius.default, backgroundColor: colors.surfaceHover, opacity }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
