// ponytail: --glow and --surface-gradient are skipped here — they need
// expo-linear-gradient, not yet a project dependency. Add both if/when an
// area:app task genuinely needs the depth accent (see DESIGN_STANDARDS.md's
// Mobile-specific section).
export const colors = {
  bg: '#7D2027',
  surface: '#8A2C35',
  surfaceHover: '#97363F',
  border: '#5C171C',

  primary: '#CE9042',
  primaryHover: '#DCA35A',
  primaryActive: '#B67C34',

  ink: '#2A0E11',
  text: '#F5EBDD',
  textMuted: '#E0C9AE',
  textDisabled: '#B0857A',

  success: '#A3D18E',
  warning: '#E8C572',
  error: '#F5B79B',
  errorHover: '#F0A588',

  cardHighlight: 'rgba(206,144,66,0.5)',
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 28,
  xxl: 36,
} as const;

export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
  12: 48,
  16: 64,
} as const;

export const radius = {
  default: 8,
  full: 999,
} as const;
