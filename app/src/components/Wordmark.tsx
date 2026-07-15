import { SvgXml } from 'react-native-svg';

// ponytail: inlined (not loaded from app/assets/roamly-wordmark.svg at runtime)
// — Metro needs react-native-svg-transformer to import .svg files as
// components, an extra babel/metro config step this single-icon use doesn't
// justify. The asset file stays in sync as the source-of-record copy; this
// string mirrors it exactly. Add the transformer if a second SVG asset shows up.
const WORDMARK_XML = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 244 96" role="img" aria-label="Roamly">
  <text x="2" y="50" font-family="-apple-system, 'Segoe UI', Inter, Roboto, sans-serif"
        font-size="54" font-weight="650" letter-spacing="-1.5" fill="#CE9042">Roamly</text>
  <path d="M8 72 C 70 62, 132 92, 196 82" fill="none"
        stroke="#CE9042" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 9"/>
  <circle cx="8" cy="72" r="4.5" fill="#CE9042"/>
  <g transform="translate(178 48) scale(1.55)">
    <path d="M12 22s8-6.5 8-12a8 8 0 1 0-16 0c0 5.5 8 12 8 12z" fill="none"
          stroke="#CE9042" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="12" cy="10" r="2.8" fill="#CE9042"/>
  </g>
</svg>
`;

const ASPECT_RATIO = 96 / 244;

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
