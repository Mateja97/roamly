import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { feedStateStyles } from './feedStateStyles';

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const focus = useFocusable();
  return (
    <View style={styles.errorState}>
      <Text style={styles.errorText}>{message}</Text>
      <Pressable
        onPress={onRetry}
        onFocus={focus.onFocus}
        onBlur={focus.onBlur}
        accessibilityRole="button"
        accessibilityLabel="Try again"
        style={[feedStateStyles.secondaryButton, focus.focused && feedStateStyles.secondaryButtonFocused]}
      >
        <Text style={feedStateStyles.secondaryButtonLabel}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  errorState: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.default,
    padding: space[3],
    gap: space[3],
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.error,
    textAlign: 'center',
  },
});
