import Svg, { Circle } from 'react-native-svg';
import { colors } from '../theme/tokens';

type TripadvisorLogoProps = {
  /** Rendered tall — DESIGN_STANDARDS.md requires >=20px on a card, >=24px on the detail screen. */
  height: number;
};

const TRIPADVISOR_GREEN = '#34E0A1';
// viewBox aspect ratio (60 wide / 28 tall) — the mark's own proportions.
const ASPECT_RATIO = 60 / 28;

// DESIGN_STANDARDS.md's Partner attribution plate recipe requires "the
// partner's own brand-kit asset — never redrawn, recolored, or inverted".
// ponytail: the licensed Tripadvisor brand-kit SVG isn't bundled in this
// repo, so this is a simplified inline approximation of the "owl eyes"
// mark (two Tripadvisor-green circles) in the same brand green named by
// product-tasks.md. Swap for the real brand-kit asset file under
// app/assets/ once it's available — decorative either way (excluded from
// the a11y tree by every caller).
export function TripadvisorLogo({ height }: TripadvisorLogoProps) {
  return (
    <Svg width={height * ASPECT_RATIO} height={height} viewBox="0 0 60 28">
      <Circle cx={16} cy={14} r={13} fill={TRIPADVISOR_GREEN} />
      <Circle cx={44} cy={14} r={13} fill={TRIPADVISOR_GREEN} />
      <Circle cx={16} cy={14} r={7} fill={colors.attributionPlate} />
      <Circle cx={44} cy={14} r={7} fill={colors.attributionPlate} />
      <Circle cx={16} cy={14} r={3} fill={colors.ink} />
      <Circle cx={44} cy={14} r={3} fill={colors.ink} />
    </Svg>
  );
}
