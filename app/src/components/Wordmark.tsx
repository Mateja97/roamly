import { SvgXml } from 'react-native-svg';

// ponytail: inlined (not loaded from app/assets/roamly-wordmark.svg at runtime)
// — Metro needs react-native-svg-transformer to import .svg files as
// components, an extra babel/metro config step this single-icon use doesn't
// justify. The asset file stays in sync as the source-of-record copy; this
// string mirrors it exactly. Add the transformer if a second SVG asset shows up.
const WORDMARK_XML = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 244 78" role="img" aria-label="Roamly">
  <text x="2" y="50" font-family="-apple-system, 'Segoe UI', Inter, Roboto, sans-serif"
        font-size="54" font-weight="650" letter-spacing="-1.5" fill="#CE9042">Roamly</text>
  <path d="M8 66 C 62 58, 112 74, 162 64 S 212 58, 228 64" fill="none"
        stroke="#CE9042" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 9"/>
  <circle cx="8" cy="66" r="4.5" fill="#CE9042"/>
  <circle cx="228" cy="64" r="4.5" fill="none" stroke="#CE9042" stroke-width="3"/>
</svg>
`;

const ASPECT_RATIO = 78 / 244;

type WordmarkProps = {
  width?: number;
};

export function Wordmark({ width = 140 }: WordmarkProps) {
  return (
    <SvgXml
      xml={WORDMARK_XML}
      width={width}
      height={width * ASPECT_RATIO}
      accessibilityLabel="Roamly"
    />
  );
}
