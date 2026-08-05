import { useEffect, useRef, useState } from 'react';
import type { ElementRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Globe, MapPin, X } from 'lucide-react-native';
import type { ActivitiesQueryResult } from '../../api/activities';
import type { CitySuggestion } from '../../api/cities';
import { FilterChip } from '../../components/FilterChip';
import { AnywherePane } from './AnywherePane';
import { FilterGroup } from './FilterGroup';
import { NearbyPane } from './NearbyPane';
import { ScopeTicket } from '../../components/ScopeTicket';
import { Spinner } from '../../components/Spinner';
import { useCitySearch } from './useCitySearch';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { RATING_OPTIONS } from '../activity-list/filters';
import type { Scope } from '../../types/scope';
import { useNearbyLocation } from '../../hooks/useNearbyLocation';
import { cityKey, defaultScopeDraft } from './scopeDraft';
import type { ScopeDraft } from './scopeDraft';

type ScopeSheetProps = {
  visible: boolean;
  initialDraft: ScopeDraft;
  // Runs the underlying query for the current draft (the caller — the Feed,
  // T3 — is responsible for merging in its own category/subtype filters;
  // this sheet never touches those). Used both for the silent, debounced
  // live-count refresh and for the explicit "Show N activities" tap.
  onQuery: (draft: ScopeDraft) => Promise<ActivitiesQueryResult>;
  // Commits the draft to the caller's applied scope state. Only ever called
  // after a successful onQuery from the explicit tap (never from the live
  // count) — apply-in-flight/error lifecycle, same contract as FilterSheet.
  onApply: (draft: ScopeDraft) => void;
  onClose: () => void;
};

// Same debounce window AnywhereSearchScreen/NearbySearchSetupScreen already
// use for their live-count re-queries and city typeahead.
const DEBOUNCE_MS = 300;

// design-spec.md T2 / product-tasks.md T2: reuses FilterSheet's bottom-sheet
// chrome (scrim, slide-up --surface panel, gold top edge, focus trap,
// safe-area footer, apply-in-flight/error lifecycle) rather than new sheet
// infrastructure — this is the rename-and-recompose of that plumbing product-
// tasks.md calls for, not a rebuild. Owns Nearby/Anywhere scope, city
// selection, the canonical 7-stop distance scale, and minimum rating.
// Category/subtype controls are deliberately absent — they move to the Feed
// (T3), not duplicated here.
export function ScopeSheet({ visible, initialDraft, onQuery, onApply, onClose }: ScopeSheetProps) {
  // `draft`/`error` are seeded straight from props above (via useState's
  // initializer) rather than reset by an effect — the caller remounts this
  // component (keyed on open/closed, same contract as FilterSheet) every
  // time it opens, so a fresh mount already means a fresh draft.
  const [draft, setDraft] = useState<ScopeDraft>(initialDraft);
  const [count, setCount] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<ElementRef<typeof Pressable>>(null);
  const [translateY] = useState(() => new Animated.Value(OFFSCREEN_Y));
  const [scrimOpacity] = useState(() => new Animated.Value(0));
  const insets = useSafeAreaInsets();
  const nearby = useNearbyLocation();

  const [cityQuery, setCityQuery] = useState('');
  const cityFetch = useCitySearch(cityQuery, draft.cities);

  // Open effect: move focus into the panel + entrance animation — identical
  // to FilterSheet's (see that file's comment for the reduce-motion/
  // fixed-OFFSCREEN_Y reasoning).
  useEffect(() => {
    if (!visible) return;
    closeRef.current?.focus?.();

    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled) return;
      if (reduceMotion) {
        translateY.setValue(0);
        scrimOpacity.setValue(1);
        return;
      }
      translateY.setValue(OFFSCREEN_Y);
      scrimOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(scrimOpacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    });
    return () => {
      cancelled = true;
    };
  }, [visible, translateY, scrimOpacity]);

  // Live count: debounced re-query on every draft change (design-spec.md
  // T2's footer rule) — mirrors AnywhereSearchScreen/NearbySearchSetupScreen's
  // existing pattern. Ignores its own failures (keeps the last known count,
  // never blanks); only the explicit Show tap below surfaces an error.
  const requestSeq = useRef(0);
  useEffect(() => {
    if (!visible) return;
    const seq = ++requestSeq.current;
    const timer = setTimeout(() => {
      onQuery(draft).then((result) => {
        if (requestSeq.current !== seq) return; // superseded by a newer change
        if (result.status === 'success') setCount(result.activities.length);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draft drives the re-query; onQuery's identity isn't a real dependency (same pattern as AnywhereSearchScreen)
  }, [draft, visible]);

  // scopeDraft.ts's `cities`/`maxDistanceKm` comments claim "always empty"/
  // "permanent null" for nearby — switching to nearby has to actually
  // enforce that, not just leave stale Anywhere-only values sitting under
  // `scope: 'nearby'` for onQuery/onApply to see. `coordinates`/`minRating`
  // aren't scope-specific (a device anchor and a rating floor both still
  // apply either way), so those carry over untouched.
  function selectScope(scope: Scope) {
    setDraft((prev) => (scope === 'nearby' ? { ...prev, scope, cities: [], maxDistanceKm: null } : { ...prev, scope }));
  }

  // Read-only permission check on entering the Nearby pane with no anchor
  // yet — detects an already-denied permission on a fresh mount without
  // requiring the "Turn on location" tap first (that tap is still what
  // triggers an actual OS prompt for an undetermined user; this never does).
  useEffect(() => {
    if (visible && draft.scope === 'nearby' && !draft.coordinates) {
      nearby.checkPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nearby.checkPermission's identity is stable (useCallback with no deps); re-run only when the pane becomes relevant again
  }, [visible, draft.scope, draft.coordinates]);

  function selectCity(city: CitySuggestion) {
    setDraft((prev) => ({ ...prev, cities: [...prev.cities, city] }));
    setCityQuery('');
  }

  function removeCity(city: CitySuggestion) {
    setDraft((prev) => ({ ...prev, cities: prev.cities.filter((c) => cityKey(c) !== cityKey(city)) }));
  }

  async function handleTurnOnLocation() {
    const coordinates = await nearby.requestLocation();
    if (coordinates) setDraft((prev) => ({ ...prev, coordinates }));
  }

  function handleReset() {
    setDraft((prev) => defaultScopeDraft(prev.scope, prev.coordinates));
    setCityQuery('');
    setError(null);
  }

  async function handleShow() {
    setApplying(true);
    setError(null);
    const result = await onQuery(draft);
    setApplying(false);
    if (result.status === 'success') {
      setCount(result.activities.length);
      onApply(draft);
      onClose();
    } else {
      setError(result.message);
    }
  }

  const closeFocus = useFocusable();
  const applyFocus = useFocusable();
  const resetFocus = useFocusable();

  const zeroResults = count === 0;
  const ctaDisabled = applying || count === null || zeroResults;
  const ctaLabel = applying ? 'Applying…' : count === null ? 'Show activities' : `Show ${count} ${count === 1 ? 'activity' : 'activities'}`;

  const trimmedCityQuery = cityQuery.trim();
  const isCityLoading = trimmedCityQuery.length > 0 && cityFetch.query !== trimmedCityQuery;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]}>
          <Pressable style={ABSOLUTE_FILL} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close scope" />
        </Animated.View>

        <Animated.View style={[styles.panel, { transform: [{ translateY }] }]} accessibilityViewIsModal>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Where to?</Text>
            <Pressable
              ref={closeRef}
              onPress={onClose}
              onFocus={closeFocus.onFocus}
              onBlur={closeFocus.onBlur}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={[styles.closeButton, closeFocus.focused && styles.closeButtonFocused]}
            >
              <X size={20} color={colors.text} strokeWidth={1.75} />
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.tickets}>
              <ScopeTicket
                icon={MapPin}
                title="Nearby"
                hint="Within reach"
                selected={draft.scope === 'nearby'}
                accessibilityLabel="Scope: Nearby"
                onPress={() => selectScope('nearby')}
              />
              <ScopeTicket
                icon={Globe}
                title="Anywhere"
                hint="Across the world"
                selected={draft.scope === 'anywhere'}
                accessibilityLabel="Scope: Anywhere"
                onPress={() => selectScope('anywhere')}
              />
            </View>

            {draft.scope === 'nearby' ? (
              <NearbyPane coordinates={draft.coordinates} nearbyState={nearby.state} onTurnOnLocation={handleTurnOnLocation} />
            ) : (
              <AnywherePane
                draft={draft}
                cityQuery={cityQuery}
                onCityQueryChange={setCityQuery}
                cityFetch={cityFetch}
                isCityLoading={isCityLoading}
                onSelectCity={selectCity}
                onRemoveCity={removeCity}
                onDistanceChange={(maxDistanceKm) => setDraft((prev) => ({ ...prev, maxDistanceKm }))}
              />
            )}

            <FilterGroup label="Minimum rating">
              {RATING_OPTIONS.map((option) => (
                <FilterChip
                  key={option.label}
                  variant="select"
                  label={option.label}
                  selected={draft.minRating === option.value}
                  onPress={() => setDraft((prev) => ({ ...prev, minRating: option.value }))}
                />
              ))}
            </FilterGroup>
          </ScrollView>

          {/* Zero-result guidance and the apply-failure banner are mutually
              exclusive in practice (a failed apply leaves count at its last
              known value) but both sit above the footer as reserved,
              always-visible space, same placement rule as FilterSheet's
              error box. */}
          {!error && zeroResults && (
            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>No matches — widen distance or add a city</Text>
            </View>
          )}
          {error && (
            <View style={[styles.noticeBox, styles.noticeBoxError]}>
              <Text style={[styles.noticeText, styles.noticeTextError]}>{error}</Text>
            </View>
          )}

          <View style={[styles.footer, { paddingBottom: space[6] + insets.bottom }]}>
            <Pressable
              onPress={handleShow}
              onFocus={applyFocus.onFocus}
              onBlur={applyFocus.onBlur}
              disabled={ctaDisabled}
              accessibilityRole="button"
              accessibilityLabel={ctaLabel}
              style={[
                styles.applyButton,
                applyFocus.focused && styles.applyButtonFocused,
                ctaDisabled && !applying && styles.applyButtonDisabled,
              ]}
            >
              {applying && <Spinner />}
              <Text style={[styles.applyLabel, ctaDisabled && !applying && styles.disabledLabel]}>{ctaLabel}</Text>
            </Pressable>
            <Pressable
              onPress={handleReset}
              onFocus={resetFocus.onFocus}
              onBlur={resetFocus.onBlur}
              accessibilityRole="button"
              accessibilityLabel="Reset"
              style={[styles.resetButton, resetFocus.focused && styles.resetButtonFocused]}
            >
              <Text style={styles.resetLabel}>Reset</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const OFFSCREEN_Y = 600;

// RN's own `StyleSheet.absoluteFillObject` isn't typed in this RN version's
// generated `.d.ts` — same accepted workaround as FilterSheet's.
const ABSOLUTE_FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    ...ABSOLUTE_FILL,
    backgroundColor: colors.scrim,
  },
  panel: {
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.default,
    borderTopRightRadius: radius.default,
    borderTopWidth: 1,
    borderTopColor: colors.cardHighlight,
    paddingHorizontal: space[6],
    paddingTop: space[3],
  },
  body: {
    flexShrink: 1,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    marginBottom: space[4],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: fontSize.lg,
    color: colors.text,
    fontWeight: '500',
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: radius.default,
    alignItems: 'center',
    justifyContent: 'center',
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  closeButtonFocused: {
    backgroundColor: colors.surfaceHover,
  },
  scroll: {
    paddingVertical: space[4],
    gap: space[6],
  },
  tickets: {
    gap: space[4],
  },
  // Shared box for the zero-result copy and the apply-failure banner — same
  // shape, only the border/text color swaps for the error variant below.
  noticeBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopColor: colors.cardHighlight,
    borderRadius: radius.default,
    padding: space[3],
    marginTop: space[3],
  },
  noticeBoxError: {
    borderColor: colors.error,
    borderTopColor: colors.error,
  },
  noticeText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  noticeTextError: {
    color: colors.error,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingVertical: space[4],
  },
  applyButton: {
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
  applyButtonFocused: {
    borderColor: colors.text,
  },
  applyButtonDisabled: {
    backgroundColor: colors.surfaceHover,
  },
  applyLabel: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  disabledLabel: {
    color: colors.textDisabled,
  },
  resetButton: {
    minHeight: 44,
    borderRadius: radius.default,
    paddingHorizontal: space[4],
    alignItems: 'center',
    justifyContent: 'center',
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  resetButtonFocused: {
    backgroundColor: colors.surfaceHover,
  },
  resetLabel: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.textMuted,
  },
});
