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

  // T1: DESIGN_STANDARDS.md's new --text-overline Standard addition — warm
  // gold overline color for the Splash screen's two overline eyebrows
  // (tagline + "Destination"), 6.18:1 on --bg. Reconciles the shipped
  // ScopePickerScreen's divergent #E0C9AE/#E6C79A use for an identical role
  // onto one value; scoped to those two overlines, not a --text-muted swap.
  textOverline: '#E6C79A',

  success: '#A3D18E',
  warning: '#E8C572',
  error: '#F5B79B',
  errorHover: '#F0A588',

  cardHighlight: 'rgba(206,144,66,0.5)',
  scrim: 'rgba(42,14,17,0.72)',

  // T8: DESIGN_STANDARDS.md's Partner attribution plate recipe — a fixed
  // white plate a partner's brand asset + API rating image sit on so the
  // wine page background never shows through (Tripadvisor's first user).
  // Not a general surface; only for partner-mandated lockups.
  attributionPlate: '#FFFFFF',

  // T4: fullscreen photo viewer's opaque near-black backdrop — DESIGN_STANDARDS.md's
  // --photo-viewer-bg, distinct from wine --bg/--scrim/--ink so photos are the only
  // color on that one surface.
  photoViewerBg: '#0F0405',

  // T2: DESIGN_STANDARDS.md's --hero-overlay-gradient — a directional scrim
  // over the Detail hero photo carousel (dark top for the back chevron, near-
  // opaque wine bottom for the caption). Top stop #17090B (near-black wine),
  // bottom stop --bg #7D2027 at 0.95. expo-linear-gradient is already a
  // dependency (see surfaceGradient/glow below).
  heroOverlayGradient: {
    colors: ['rgba(23,9,11,0.5)', 'rgba(23,9,11,0)', 'rgba(125,32,39,0.95)'] as const,
    locations: [0, 0.4, 1] as const,
  },

  // Scope ticket's --surface-gradient (top-lit body) and --glow (one
  // per-screen radial accent, approximated as a linear fade — see
  // ScopeTicket.tsx). Welcome screen is the one area:app surface that
  // brought in expo-linear-gradient for these (see DESIGN_STANDARDS.md's
  // Mobile-specific "Depth devices deferred" exception) — don't reach for
  // them on other app surfaces without the same justification.
  surfaceGradient: ['#93313A', '#8A2C35'] as const,
  glow: 'rgba(206,144,66,0.16)',
  // T3: same glow color as `glow` above, split so a native react-native-svg
  // <Stop> can use `stopColor`+`stopOpacity` — native react-native-svg
  // doesn't reliably read alpha baked into an rgba() `stopColor` string (the
  // T2 regression). `glow` itself is untouched and stays the rgba string
  // expo-linear-gradient's `colors` prop wants (see ScopeTicket.tsx).
  glowOpacity: 0.16,
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

// --font-display (Marcellus) — the display accent. For **screen-identity
// headers** specifically (a screen's own title/H1, not a section heading
// within it), DESIGN_STANDARDS.md's "Marcellus header sizes" list is the
// single source of the exact set + sizes — don't duplicate that list here,
// it goes stale. Marcellus is also used more narrowly as a decorative
// accent on a few supporting lines that list deliberately excludes (a
// reviews score number, the traveler row's heading) — those aren't screen
// identity, so they're not "Marcellus header sizes" entries. (The Feed's
// context line used to be a third such use at 20px — removed per the T5
// audit fix: DESIGN_STANDARDS.md never sanctioned it and 20px falls under
// the documented set's own "every size ≥24px" contrast invariant, so this
// was a code/spec divergence, not a deliberate exception.) Loaded once,
// globally, gated by App.tsx's
// font-load gate (moved there from ScopePickerScreen in T1 so every screen
// rides on one gate, Marcellus loads once). Every other surface stays on
// RN's system font stack (the default when no fontFamily is set).
export const fontFamily = {
  display: 'Marcellus_400Regular',
} as const;
