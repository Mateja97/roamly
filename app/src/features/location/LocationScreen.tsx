import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, BackHandler, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, MapPin, Search, SearchX, X } from 'lucide-react-native';
import type { Place, PlaceSuggestion } from '../../api/places';
import { hasPlacesKey } from '../../api/places';
import { Skeleton } from '../../components/Skeleton';
import { Spinner } from '../../components/Spinner';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { usePlaceSearch } from './usePlaceSearch';
import type { LocationScreenProps } from './types';

const NO_KEY_HINT = "We couldn't reach place search. You can continue with the default location below.";

// T4's Location screen — serves both the city scope (needs coordinates) and
// the country scope (needs a name), configured by `config`. No custom back
// control per design-spec.md; Android hardware back returns to the scope
// picker (same BackHandler pattern ActivityListScreen already uses — there's
// no stack navigator yet, see App.tsx).
export function LocationScreen({ config, onConfirm, onBack }: LocationScreenProps) {
  // Checked once at mount, not re-derived per render — a missing key isn't
  // going to appear mid-session. ponytail: the no-key fallback triggers on a
  // missing key only, not a proactive reachability probe at mount (that
  // would cost a billed request just to detect what the user's first
  // keystroke already reveals for free via the retryable lookup-error path).
  const [noKey] = useState(() => !hasPlacesKey());
  const search = usePlaceSearch(config);
  const [confirming, setConfirming] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const inputFocus = useFocusable();
  const clearFocus = useFocusable();
  const retryFocus = useFocusable();
  const confirmFocus = useFocusable();
  const [regionOpacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  const selectedPlace = noKey ? config.defaultPlace : search.selected;
  const busy = search.region.view === 'loading';

  // Cross-fade the results region (summary/skeleton/list/empty/error) on
  // opacity only, ≤150ms, per design-spec's Motion section; reduced-motion
  // snaps straight to visible (no animation). `noKey` never changes after
  // mount so `search.region.view` alone is the right dependency.
  // ponytail: did-mount ref, not a library — this is a content swap between
  // already-rendered states, not a transition on first paint (design-spec's
  // Motion section), so the very first run (mount) must skip the fade.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    if (reduceMotion) {
      regionOpacity.setValue(1);
      return;
    }
    regionOpacity.setValue(0);
    Animated.timing(regionOpacity, {
      toValue: 1,
      duration: 150,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [search.region.view, reduceMotion, regionOpacity]);

  function handleConfirm() {
    setConfirming(true);
    onConfirm(selectedPlace);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{config.headerTitle}</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>Search for a place, or confirm the suggested one.</Text>

          {noKey ? (
            <View style={styles.noticeBox}>
              <View style={styles.badge}>
                <Text style={styles.badgeLabel}>Search unavailable</Text>
              </View>
              <Text style={styles.noticeHint}>{NO_KEY_HINT}</Text>
            </View>
          ) : (
            <View>
              <Text style={styles.inputLabel}>{config.inputLabel}</Text>
              <View style={[styles.inputRow, inputFocus.focused && styles.inputRowFocused]}>
                <Search size={16} color={colors.text} strokeWidth={1.75} />
                <TextInput
                  value={search.query}
                  onChangeText={search.setQuery}
                  onFocus={inputFocus.onFocus}
                  onBlur={inputFocus.onBlur}
                  placeholder={config.placeholder}
                  placeholderTextColor={colors.textDisabled}
                  style={styles.input}
                  accessibilityLabel={config.inputLabel}
                />
                {busy ? (
                  <Spinner />
                ) : (
                  search.query.length > 0 && (
                    <Pressable
                      onPress={() => search.setQuery('')}
                      onFocus={clearFocus.onFocus}
                      onBlur={clearFocus.onBlur}
                      accessibilityRole="button"
                      accessibilityLabel="Clear search"
                      style={[styles.clearButton, clearFocus.focused && styles.clearButtonFocused]}
                    >
                      <X size={16} color={colors.textMuted} strokeWidth={1.75} />
                    </Pressable>
                  )
                )}
              </View>
            </View>
          )}

          <Animated.View
            style={[styles.resultsRegion, { opacity: regionOpacity }]}
            accessible
            accessibilityLiveRegion="polite"
          >
            {noKey ? (
              <SummaryCard place={config.defaultPlace} readOnly />
            ) : search.region.view === 'suggestions' ? (
              // ponytail: rows are directly tappable, focusable, and announce
              // their full accessible name (SuggestionRow below) — real
              // arrow-key/Escape combobox semantics are a desktop-keyboard
              // idiom this touch-first screen skips; add if a hardware
              // keyboard becomes a first-class input for this app.
              <View style={styles.rows}>
                {search.region.items.map((item) => (
                  <SuggestionRow key={item.placeId} item={item} onPress={() => search.pick(item)} />
                ))}
              </View>
            ) : busy ? (
              <View style={styles.rows}>
                <Skeleton width="100%" height={44} />
                <Skeleton width="100%" height={44} />
                <Skeleton width="100%" height={44} />
              </View>
            ) : search.region.view === 'empty' ? (
              <View style={styles.emptyState}>
                <SearchX size={20} color={colors.textMuted} strokeWidth={1.75} />
                <Text style={styles.emptyTitle}>No places found</Text>
                <Text style={styles.emptyHint}>Check the spelling or try a broader term.</Text>
              </View>
            ) : search.region.view === 'error' ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{search.region.message}</Text>
                <Pressable
                  onPress={search.retry}
                  onFocus={retryFocus.onFocus}
                  onBlur={retryFocus.onBlur}
                  accessibilityRole="button"
                  accessibilityLabel="Try again"
                  style={[styles.secondaryButton, retryFocus.focused && styles.secondaryButtonFocused]}
                >
                  <Text style={styles.secondaryButtonLabel}>Try again</Text>
                </Pressable>
              </View>
            ) : (
              <SummaryCard place={search.selected} />
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <Pressable
          onPress={handleConfirm}
          onFocus={confirmFocus.onFocus}
          onBlur={confirmFocus.onBlur}
          disabled={confirming}
          accessibilityRole="button"
          accessibilityLabel={confirming ? 'Confirming' : 'Confirm'}
          style={[styles.confirmButton, confirmFocus.focused && styles.confirmButtonFocused]}
        >
          {confirming && !reduceMotion && <Spinner />}
          <Text style={styles.confirmLabel}>{confirming ? 'Confirming…' : 'Confirm'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function SummaryCard({ place, readOnly = false }: { place: Place; readOnly?: boolean }) {
  return (
    <View style={styles.summaryCard}>
      <MapPin size={16} color={colors.primary} strokeWidth={1.75} />
      <View style={styles.summaryText}>
        <Text style={styles.summaryName}>{place.name}</Text>
        {place.region && <Text style={styles.summaryRegion}>{place.region}</Text>}
      </View>
      {!readOnly && <Check size={16} color={colors.primary} strokeWidth={1.75} />}
    </View>
  );
}

function SuggestionRow({ item, onPress }: { item: PlaceSuggestion; onPress: () => void }) {
  const focus = useFocusable();
  return (
    <Pressable
      onPress={onPress}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      accessibilityRole="button"
      accessibilityLabel={item.secondaryText ? `${item.primaryText}, ${item.secondaryText}` : item.primaryText}
      style={[styles.row, focus.focused && styles.rowFocused]}
    >
      <MapPin size={16} color={colors.textMuted} strokeWidth={1.75} />
      <View style={styles.rowText}>
        <Text style={styles.rowPrimary}>{item.primaryText}</Text>
        {item.secondaryText ? <Text style={styles.rowSecondary}>{item.secondaryText}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: space[4],
    paddingHorizontal: space[6],
  },
  headerTitle: {
    fontSize: fontSize.lg,
    color: colors.text,
    fontWeight: '500',
  },
  content: {
    padding: space[4],
    gap: space[4],
  },
  intro: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  inputLabel: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    marginBottom: space[2],
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: 44,
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.default,
    paddingHorizontal: space[3],
  },
  inputRowFocused: {
    borderColor: colors.primary,
  },
  input: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.text,
    paddingVertical: space[3],
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  clearButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  clearButtonFocused: {
    backgroundColor: colors.surface,
    borderRadius: radius.default,
  },
  noticeBox: {
    gap: space[2],
  },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: radius.full,
    paddingVertical: space[1],
    paddingHorizontal: space[2],
  },
  badgeLabel: {
    fontSize: fontSize.xs,
    fontWeight: '500',
    color: colors.warning,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  noticeHint: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  // Reserved height sized to the tallest content (3 suggestion/skeleton
  // rows) so switching between summary/skeleton/list/empty/error never
  // moves the Confirm button (No-layout-jump rule).
  resultsRegion: {
    minHeight: 180,
  },
  rows: {
    gap: space[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 44,
    borderRadius: radius.default,
    paddingHorizontal: space[3],
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  rowFocused: {
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  rowText: {
    flex: 1,
  },
  rowPrimary: {
    fontSize: fontSize.sm,
    color: colors.text,
  },
  rowSecondary: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 1,
    borderTopColor: colors.cardHighlight,
    borderRadius: radius.default,
    padding: space[4],
  },
  summaryText: {
    flex: 1,
    gap: space[1],
  },
  summaryName: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  summaryRegion: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: space[12],
    gap: space[3],
  },
  emptyTitle: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  emptyHint: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
  },
  errorBox: {
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
  footer: {
    flexDirection: 'row',
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[6],
  },
  confirmButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    minHeight: 44,
    borderRadius: radius.default,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: colors.primary,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  confirmButtonFocused: {
    borderColor: colors.text,
  },
  confirmLabel: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.ink,
  },
});
