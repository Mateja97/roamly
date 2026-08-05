import { StyleSheet } from 'react-native';
import { colors, fontSize, radius, space } from '../../theme/tokens';

// Shared between EmptyState and ErrorState — both render the same
// secondary-button treatment for their retry/clear-filters action.
export const feedStateStyles = StyleSheet.create({
  secondaryButton: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.default,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[6],
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  secondaryButtonFocused: {
    backgroundColor: colors.surfaceHover,
    borderColor: colors.primary,
  },
  secondaryButtonLabel: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
});
