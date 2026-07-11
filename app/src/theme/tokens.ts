// ponytail: --glow and --surface-gradient are skipped here — they need
// expo-linear-gradient, not yet a project dependency. Add both if/when an
// area:app task genuinely needs the depth accent (see DESIGN_STANDARDS.md's
// Mobile-specific section).
export const colors = {
  bg: '#14160f',
  surface: '#1b1e14',
  surfaceHover: '#242819',
  border: '#2e331f',

  primary: '#8a9a5b',
  primaryHover: '#a4b378',
  primaryActive: '#6e7c46',

  text: '#edefe6',
  textMuted: '#9ba08c',
  textDisabled: '#5c6152',

  success: '#7fa65b',
  warning: '#c9a227',
  error: '#cc7350',
  errorHover: '#d98963',

  cardHighlight: '#383e26',
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
