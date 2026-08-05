import { StyleSheet } from 'react-native';
import { colors, fontSize, space } from '../../theme/tokens';

// Style rules shared by more than one of ScopeSheet's extracted panes
// (NearbyPane, AnywherePane, DistanceSlider) — kept here rather than
// re-declared per file so a value only ever has one source of truth.
export const scopeSheetStyles = StyleSheet.create({
  section: {
    gap: space[3],
  },
  sectionLabel: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
