import { Pressable, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useFocusable } from '../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../theme/tokens';

type ErrorBannerProps = {
  message: string;
  onDismiss: () => void;
};

// DESIGN_STANDARDS.md's "Error banner/toast" recipe — the baseline fallback
// for any API/OS-handoff failure a task's design doesn't call out
// explicitly. First reusable component for it (T4's CTA presses are the
// first callers with more than one failure surface on a screen).
export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  const dismissFocus = useFocusable();

  return (
    <View style={styles.box} accessible accessibilityLiveRegion="polite">
      <Text style={styles.text}>{message}</Text>
      <Pressable
        onPress={onDismiss}
        onFocus={dismissFocus.onFocus}
        onBlur={dismissFocus.onBlur}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={[styles.dismiss, dismissFocus.focused && styles.dismissFocused]}
      >
        <X size={16} color={colors.error} strokeWidth={1.75} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.default,
    padding: space[3],
  },
  text: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.error,
  },
  dismiss: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.default,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  dismissFocused: {
    backgroundColor: colors.surfaceHover,
    borderWidth: 2,
    borderColor: colors.primary,
  },
});
