import { useEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import { AccessibilityInfo, findNodeHandle, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';
import { Globe, MapPin } from 'lucide-react-native';
import { useFonts, Marcellus_400Regular } from '@expo-google-fonts/marcellus';
import { ScopeTicket } from '../../components/ScopeTicket';
import { Wordmark } from '../../components/Wordmark';
import { colors, fontFamily, fontSize, radius, space } from '../../theme/tokens';
import { FlightPathBackground } from './FlightPathBackground';
import { useNearbyLocation } from './useNearbyLocation';
import type { ScopeSelection } from './types';

type ScopePickerScreenProps = {
  onScopeSelected: (selection: ScopeSelection) => void;
};

export function ScopePickerScreen({ onScopeSelected }: ScopePickerScreenProps) {
  // Font-load gate: DESIGN_STANDARDS.md's Display accent rule — hold first
  // paint until Marcellus loads so the prompt never flashes in the system
  // font; fall back to the system stack if loading fails rather than block
  // the screen forever.
  const [fontsLoaded, fontError] = useFonts({ Marcellus_400Regular });

  const nearby = useNearbyLocation();
  // Anywhere reuses the identical permission/GPS-fix hook (same shape,
  // separate instance so its busy/error state doesn't collide with
  // Nearby's) — only ScopePickerScreen's handling of a denied/unavailable
  // result differs: Nearby blocks with an error, Anywhere never does.
  const anywhere = useNearbyLocation();

  const nearbyBusy = nearby.state.status === 'requesting-permission' || nearby.state.status === 'locating';
  const anywhereBusy = anywhere.state.status === 'requesting-permission' || anywhere.state.status === 'locating';
  // Single-select across the two tickets, one per-screen --glow max: Nearby
  // is the resting/default selection; Anywhere only takes the selected
  // treatment while its own request is in flight (the press/active state).
  const selectedTicket = anywhereBusy ? 'anywhere' : 'nearby';

  const messageRef = useRef<View>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  // Dashed underline tracks the headline's actual rendered width (matches
  // the mock's inline-block underline) rather than a hardcoded pixel value,
  // so it still fits if the headline wraps/grows under dynamic text scaling.
  const [headlineWidth, setHeadlineWidth] = useState(0);
  function onHeadlineLayout(event: LayoutChangeEvent) {
    setHeadlineWidth(event.nativeEvent.layout.width);
  }

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  async function handleNearbyPress() {
    const coordinates = await nearby.requestLocation();
    if (coordinates) {
      onScopeSelected({ scope: 'nearby', coordinates });
    }
  }

  // Anywhere never blocks: granted location carries coordinates forward
  // (enables the downstream distance slider); denied/unavailable still
  // advances with no coordinates (slider hidden downstream) — no error
  // state, no dead end, no crash (T2 contract).
  async function handleAnywherePress() {
    const coordinates = await anywhere.requestLocation();
    onScopeSelected({ scope: 'anywhere', coordinates: coordinates ?? undefined });
  }

  function focusMessage() {
    const handle = messageRef.current && findNodeHandle(messageRef.current);
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
  }

  function progressHint(status: 'requesting-permission' | 'locating') {
    return status === 'requesting-permission' ? 'Requesting location…' : 'Getting your location…';
  }

  const nearbyHint =
    nearby.state.status === 'requesting-permission' || nearby.state.status === 'locating'
      ? progressHint(nearby.state.status)
      : 'Within reach';
  const anywhereHint =
    anywhere.state.status === 'requesting-permission' || anywhere.state.status === 'locating'
      ? progressHint(anywhere.state.status)
      : 'Across the world';

  if (!fontsLoaded && !fontError) {
    // Hold first paint: keep the wine background stable, render nothing
    // else, until the font resolves one way or the other.
    return <SafeAreaView style={styles.screen} />;
  }

  return (
    <SafeAreaView style={styles.screen}>
      <FlightPathBackground />
      <View style={styles.content}>
        <View style={styles.logoRow}>
          <Wordmark width={246} />
          <Text style={styles.tagline}>Search activities to do</Text>
        </View>

        <View style={styles.centerBlock}>
          <View style={styles.destinationField}>
            <Text style={styles.overline}>Destination</Text>
            <Text
              style={[styles.headline, fontsLoaded && { fontFamily: fontFamily.display }]}
              onLayout={onHeadlineLayout}
            >
              Where to?
            </Text>
            {headlineWidth > 0 && (
              <Svg width={headlineWidth} height={4} style={styles.underline}>
                <Line
                  x1={0}
                  y1={2}
                  x2={headlineWidth}
                  y2={2}
                  stroke={colors.cardHighlight}
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  strokeLinecap="round"
                />
              </Svg>
            )}
          </View>

          <View style={styles.tickets}>
            <ScopeTicket
              // Clicking (not tabbing to) a Pressable on web leaves it
              // DOM-focused with no reliable onBlur, so `focused` can stay
              // stuck true — remount on every status change to drop it
              // (react-native-web focus-retention quirk, see ChoiceCard's
              // former note).
              key={`nearby-${nearby.state.status}`}
              icon={MapPin}
              title="Nearby"
              hint={nearbyHint}
              selected={selectedTicket === 'nearby'}
              busy={nearbyBusy}
              reduceMotion={reduceMotion}
              accessibilityLabel="Explore activities nearby"
              onPress={handleNearbyPress}
            />
            <ScopeTicket
              key={`anywhere-${anywhere.state.status}`}
              icon={Globe}
              title="Anywhere"
              hint={anywhereHint}
              selected={selectedTicket === 'anywhere'}
              busy={anywhereBusy}
              reduceMotion={reduceMotion}
              accessibilityLabel="Explore activities anywhere"
              onPress={handleAnywherePress}
            />
          </View>
        </View>

        <View style={styles.messageRegion}>
          {nearby.state.status === 'denied' && (
            <ErrorMessage
              ref={messageRef}
              onLayout={focusMessage}
              text="Location access is off, so we can't find activities near you. Turn it on in Settings, or choose Anywhere instead."
              actionLabel="Open settings"
              onAction={() => Linking.openSettings()}
            />
          )}
          {nearby.state.status === 'unavailable' && (
            <ErrorMessage
              ref={messageRef}
              onLayout={focusMessage}
              text="We couldn't get your current location. Try again, or choose Anywhere instead."
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
    flex: 1,
    paddingHorizontal: space[6],
  },
  logoRow: {
    alignItems: 'center',
    paddingTop: space[16] + space[6], // ~88px below the safe-area top
  },
  centerBlock: {
    flex: 1,
    justifyContent: 'center',
    gap: space[6],
  },
  destinationField: {
    alignItems: 'center',
  },
  overline: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textTransform: 'uppercase',
    fontWeight: '600',
    letterSpacing: 3, // ~0.22em at 14px
  },
  tagline: {
    marginTop: space[3],
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    fontWeight: '600',
    letterSpacing: 2.9, // ~0.24em at 12px
  },
  headline: {
    marginTop: space[3],
    fontSize: fontSize.xxl,
    lineHeight: fontSize.xxl * 1.1,
    color: colors.text,
    textAlign: 'center',
  },
  underline: {
    marginTop: space[2],
  },
  tickets: {
    gap: space[4],
  },
  messageRegion: {
    paddingBottom: space[4],
    // ponytail: minHeight: 1 (not a true reserved height) is safe only
    // because this is the last element in the column — nothing below it to
    // push down when the message appears.
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
