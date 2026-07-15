import { StyleSheet } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '../theme/tokens';

// Decorative header-sized "flight path" motif (design-spec.md's T2 addendum)
// — one dashed gold curve + two endpoint dots behind a fixed header block.
// Smaller sibling of scope-picker/FlightPathBackground's full-screen
// seven-curve pattern; not reused directly since the viewBox/curve don't fit
// a ~140px header. Shared by NearbySearchSetupScreen and AnywhereSearchScreen.
export function HeaderFlightPath() {
  return (
    <Svg
      viewBox="0 0 402 200"
      preserveAspectRatio="xMidYMid slice"
      style={styles.svg}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        d="M-20 96 C 110 50, 260 150, 430 80"
        stroke={colors.primary}
        strokeWidth={2.5}
        strokeDasharray="2 12"
        strokeLinecap="round"
        strokeOpacity={0.28}
        fill="none"
      />
      <Circle cx={-20} cy={96} r={4.5} fill={colors.primary} stroke="none" opacity={0.28} />
      <Circle cx={430} cy={80} r={5} fill="none" stroke={colors.primary} strokeWidth={3} strokeOpacity={0.28} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  svg: {
    position: 'absolute',
    top: 0,
    left: 0,
    // ponytail: explicit width/height 100% (not top/right/bottom/left: 0) —
    // on web, react-native-svg sizes the <svg> box from its viewBox aspect
    // ratio when height isn't a concrete number, so a short/wide header
    // container (unlike FlightPathBackground's near-square full-screen use)
    // rendered a box taller than the header and only its top sliver showed
    // through the header's overflow:hidden, cropping the curve out entirely.
    width: '100%',
    height: '100%',
  },
});
