import { useRef, useState } from 'react';
import type { Ref } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Globe, Home, Navigation } from 'lucide-react-native';
import { ChoiceCard } from '../../components/ChoiceCard';
import { Spinner } from '../../components/Spinner';
import { Wordmark } from '../../components/Wordmark';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { useNearbyLocation } from './useNearbyLocation';
import type { ScopeSelection } from './types';

type ScopePickerScreenProps = {
  onScopeSelected: (selection: ScopeSelection) => void;
};

export function ScopePickerScreen({ onScopeSelected }: ScopePickerScreenProps) {
  const { state, requestLocation } = useNearbyLocation();
  const messageRef = useRef<View>(null);

  const nearbyBusy = state.status === 'requesting-permission' || state.status === 'locating';

  async function handleNearbyPress() {
    const coordinates = await requestLocation();
    if (coordinates) {
      onScopeSelected({ scope: 'nearby', coordinates });
    }
  }

  function focusMessage() {
    const handle = messageRef.current && findNodeHandle(messageRef.current);
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
  }

  const nearbyHint =
    state.status === 'requesting-permission'
      ? 'Requesting location…'
      : state.status === 'locating'
        ? 'Getting your location…'
        : "What's around you right now";

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <Wordmark />
        <Text style={styles.heading}>Where do you want to explore?</Text>
        <Text style={styles.subHint}>Pick a scope to start browsing activities.</Text>

        <View style={styles.cards}>
          <ChoiceCard
            icon={Home}
            title="Home"
            hint="Activities around your home base"
            onPress={() => onScopeSelected({ scope: 'home' })}
          />
          <ChoiceCard
            icon={Navigation}
            title="Nearby"
            hint={nearbyHint}
            busy={nearbyBusy}
            onPress={handleNearbyPress}
            accessoryRight={nearbyBusy ? <Spinner /> : undefined}
          />
          <ChoiceCard
            icon={Globe}
            title="Outside country"
            hint="Explore activities abroad"
            onPress={() => onScopeSelected({ scope: 'outside_country' })}
          />
        </View>

        <View style={styles.messageRegion}>
          {state.status === 'denied' && (
            <ErrorMessage
              ref={messageRef}
              onLayout={focusMessage}
              text="Location access is off, so we can't find activities near you. Turn it on in Settings, or pick Home or Outside country instead."
              actionLabel="Open settings"
              onAction={() => Linking.openSettings()}
            />
          )}
          {state.status === 'unavailable' && (
            <ErrorMessage
              ref={messageRef}
              onLayout={focusMessage}
              text="We couldn't get your current location. Try again, or pick Home or Outside country instead."
              actionLabel="Try again"
              onAction={handleNearbyPress}
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

type ErrorMessageProps = {
  text: string;
  actionLabel: string;
  onAction: () => void;
  onLayout: () => void;
  ref: Ref<View>;
};

// React 19: `ref` is a plain prop on function components, no forwardRef needed.
const ErrorMessage = ({ text, actionLabel, onAction, onLayout, ref }: ErrorMessageProps) => {
  const [focused, setFocused] = useState(false);

  return (
    <View
      ref={ref}
      onLayout={onLayout}
      style={styles.errorBox}
      accessible
      accessibilityLiveRegion={Platform.OS === 'android' ? 'polite' : undefined}
    >
      <Text style={styles.errorText}>{text}</Text>
      <Pressable
        onPress={onAction}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        style={({ pressed }) => [
          styles.secondaryButton,
          (pressed || focused) && styles.secondaryButtonPressed,
        ]}
      >
        <Text style={styles.secondaryButtonLabel}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flexGrow: 1,
    paddingTop: space[8],
    paddingHorizontal: space[4],
  },
  heading: {
    fontSize: fontSize.xl,
    color: colors.primary,
    fontWeight: '700',
    marginTop: space[6],
  },
  subHint: {
    fontSize: fontSize.md,
    color: colors.textMuted,
    marginTop: space[3],
  },
  cards: {
    marginTop: space[8],
    gap: space[4],
  },
  messageRegion: {
    marginTop: space[4],
    minHeight: 1,
  },
  errorBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.default,
    padding: space[3],
    gap: space[2],
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.error,
  },
  secondaryButton: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.default,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[6],
    alignSelf: 'flex-start',
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  secondaryButtonPressed: {
    backgroundColor: colors.surfaceHover,
    borderColor: colors.primary,
  },
  secondaryButtonLabel: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
});
