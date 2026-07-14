import { StyleSheet } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '../../theme/tokens';

// Decorative "flight paths" background motif from the Welcome screen design
// import (Roamly Welcome (2c).dc.html) — five dotted gold curves + endpoint
// markers, viewBox/paths copied verbatim from the reference. Purely
// decorative: absolute, behind everything, hidden from accessibility tools.
export function FlightPathBackground() {
  return (
    <Svg
      viewBox="0 0 402 874"
      preserveAspectRatio="xMidYMid slice"
      style={styles.svg}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        d="M-20 150 C 110 90, 260 200, 430 120"
        stroke={colors.primary}
        strokeWidth={2.5}
        strokeDasharray="2 12"
        strokeLinecap="round"
        strokeOpacity={0.38}
        fill="none"
      />
      <Circle cx={-20} cy={150} r={5} fill={colors.primary} stroke="none" opacity={0.38} />
      <Circle cx={430} cy={120} r={5.5} fill="none" stroke={colors.primary} strokeWidth={3} strokeOpacity={0.38} />

      <Path
        d="M40 230 C 160 180, 250 270, 380 200"
        stroke={colors.primary}
        strokeWidth={2}
        strokeDasharray="2 12"
        strokeLinecap="round"
        strokeOpacity={0.26}
        fill="none"
      />
      <Circle cx={40} cy={230} r={4} fill={colors.primary} stroke="none" opacity={0.26} />
      <Circle cx={380} cy={200} r={4.5} fill="none" stroke={colors.primary} strokeWidth={2.5} strokeOpacity={0.26} />

      <Path
        d="M-30 620 C 120 690, 280 560, 420 650"
        stroke={colors.primary}
        strokeWidth={2.5}
        strokeDasharray="2 12"
        strokeLinecap="round"
        strokeOpacity={0.45}
        fill="none"
      />
      <Circle cx={-30} cy={620} r={5} fill={colors.primary} stroke="none" opacity={0.45} />
      <Circle cx={420} cy={650} r={5.5} fill="none" stroke={colors.primary} strokeWidth={3} strokeOpacity={0.45} />

      <Path
        d="M20 730 C 150 670, 250 800, 400 710"
        stroke={colors.primary}
        strokeWidth={2.5}
        strokeDasharray="2 12"
        strokeLinecap="round"
        strokeOpacity={0.5}
        fill="none"
      />
      <Circle cx={20} cy={730} r={5} fill={colors.primary} stroke="none" opacity={0.5} />
      <Circle cx={400} cy={710} r={5.5} fill="none" stroke={colors.primary} strokeWidth={3} strokeOpacity={0.5} />

      <Path
        d="M50 820 C 170 860, 280 780, 380 840"
        stroke={colors.primary}
        strokeWidth={2}
        strokeDasharray="2 12"
        strokeLinecap="round"
        strokeOpacity={0.3}
        fill="none"
      />
      <Circle cx={50} cy={820} r={4} fill={colors.primary} stroke="none" opacity={0.3} />
      <Circle cx={380} cy={840} r={4.5} fill="none" stroke={colors.primary} strokeWidth={2.5} strokeOpacity={0.3} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  svg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
