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
  scrim: 'rgba(42,14,17,0.72)',

  // Scope ticket's --surface-gradient (top-lit body) and --glow (one
  // per-screen radial accent, approximated as a linear fade — see
  // ScopeTicket.tsx). Welcome screen is the one area:app surface that
  // brought in expo-linear-gradient for these (see DESIGN_STANDARDS.md's
  // Mobile-specific "Depth devices deferred" exception) — don't reach for
  // them on other app surfaces without the same justification.
  surfaceGradient: ['#93313A', '#8A2C35'] as const,
  glow: 'rgba(206,144,66,0.16)',
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
  lg: 16,
  full: 999,
} as const;

// --font-display (Marcellus) — the one display accent, used only for the
// Welcome screen's "Where do you want to go?" prompt (see
// ScopePickerScreen.tsx's font-load gate). Every other surface stays on RN's
// system font stack (the default when no fontFamily is set).
export const fontFamily = {
  display: 'Marcellus_400Regular',
} as const;
