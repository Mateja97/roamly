import { useEffect, useRef, useState } from 'react';
import type { ElementRef, ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { Globe, MapPin, Search, SearchX, X } from 'lucide-react-native';
import type { ActivitiesQueryResult } from '../../api/activities';
import type { CitySuggestion } from '../../api/cities';
import { suggestCities } from '../../api/cities';
import { FilterChip } from '../../components/FilterChip';
import { ScopeTicket } from '../../components/ScopeTicket';
import { Skeleton } from '../../components/Skeleton';
import { Spinner } from '../../components/Spinner';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { NEARBY_RADIUS_KM, RATING_OPTIONS } from '../activity-list/filters';
import { useNearbyLocation } from '../scope-picker/useNearbyLocation';
import type { NearbyLocationState } from '../scope-picker/useNearbyLocation';
import { DISTANCE_STEP_KM, MAX_DISTANCE_KM, MIN_DISTANCE_KM, anywhereHasAnchor, defaultScopeDraft } from './scopeDraft';
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

type CityFetchState = { query: string; status: 'results' | 'no-match' | 'error'; results: CitySuggestion[]; error: string | null };

// design-spec.md T2 / product-tasks.md T2: reuses FilterSheet's bottom-sheet
// chrome (scrim, slide-up --surface panel, gold top edge, focus trap,
// safe-area footer, apply-in-flight/error lifecycle) rather than new sheet
// infrastructure — this is the rename-and-recompose of that plumbing product-
// tasks.md calls for, not a rebuild. Owns Nearby/Anywhere scope, city
// selection, the canonical 5-500km distance range, and minimum rating.
// Category/subtype controls are deliberately absent — they move to the Feed
// (T3), not duplicated here.
export function ScopeSheet({ visible, initialDraft, onQuery, onApply, onClose }: ScopeSheetProps) {
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
  const [cityFetch, setCityFetch] = useState<CityFetchState>({ query: '', status: 'no-match', results: [], error: null });

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

  // City typeahead — debounced, excludes already-selected cities. Copied
  // from AnywhereSearchScreen's identical effect (design-spec.md T2: reuse
  // its city-search code verbatim).
  useEffect(() => {
    const query = cityQuery.trim();
    if (query.length === 0) return;
    const timer = setTimeout(() => {
      suggestCities(query).then((result) => {
        if (result.status !== 'success') {
          setCityFetch({ query, status: 'error', results: [], error: result.message });
          return;
        }
        const selectedKeys = new Set(draft.cities.map(cityKey));
        const suggestions = result.suggestions.filter((s) => !selectedKeys.has(cityKey(s)));
        setCityFetch({ query, status: suggestions.length === 0 ? 'no-match' : 'results', results: suggestions, error: null });
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [cityQuery, draft.cities]);

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
                onPress={() => setDraft((prev) => ({ ...prev, scope: 'nearby' }))}
              />
              <ScopeTicket
                icon={Globe}
                title="Anywhere"
                hint="Across the world"
                selected={draft.scope === 'anywhere'}
                accessibilityLabel="Scope: Anywhere"
                onPress={() => setDraft((prev) => ({ ...prev, scope: 'anywhere' }))}
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

function cityKey(city: CitySuggestion): string {
  return `${city.city}|${city.country}`;
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel} accessibilityRole="header">
        {label}
      </Text>
      <View style={styles.chipsRow}>{children}</View>
    </View>
  );
}

type NearbyPaneProps = {
  coordinates: ScopeDraft['coordinates'];
  nearbyState: NearbyLocationState;
  onTurnOnLocation: () => void;
};

// design-spec.md T2's three Nearby panes: granted / not-yet-asked / denied.
// `coordinates` present is the "granted" signal (either resolved by this
// sheet or handed in already-anchored by the caller).
// ponytail: `unavailable` (GPS fix failed after permission was already
// granted) folds into this same explainer+button rather than a fourth pane
// — the spec asks for three, and retrying via the same button is the same
// affordance ScopePickerScreen already offers for this exact case. Add a
// distinct copy/pane if a future spec calls one out.
function NearbyPane({ coordinates, nearbyState, onTurnOnLocation }: NearbyPaneProps) {
  const busy = nearbyState.status === 'requesting-permission' || nearbyState.status === 'locating';
  const buttonFocus = useFocusable();

  if (coordinates) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Range</Text>
        <View
          style={styles.rangeCard}
          accessible
          accessibilityLabel={`Range: within ${NEARBY_RADIUS_KM} km, fixed range around your location`}
        >
          <MapPin size={20} color={colors.primary} strokeWidth={1.75} />
          <View style={styles.rangeTextColumn}>
            <Text style={styles.rangeTitle}>Within {NEARBY_RADIUS_KM} km</Text>
            <Text style={styles.rangeSubtitle}>Fixed range around your location</Text>
          </View>
          <View style={styles.fixedBadge}>
            <Text style={styles.fixedBadgeLabel}>Fixed</Text>
          </View>
        </View>
      </View>
    );
  }

  if (nearbyState.status === 'denied') {
    return (
      <View style={styles.section}>
        <Text style={styles.paneText}>
          Location access is off, so we can&apos;t show what&apos;s nearby. Turn it on in Settings, or use Anywhere instead.
        </Text>
        <Pressable
          onPress={() => Linking.openSettings()}
          onFocus={buttonFocus.onFocus}
          onBlur={buttonFocus.onBlur}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          style={[styles.secondaryButton, buttonFocus.focused && styles.secondaryButtonFocused]}
        >
          <Text style={styles.secondaryButtonLabel}>Open settings</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.paneText}>See what&apos;s nearby without typing a thing.</Text>
      <Pressable
        onPress={onTurnOnLocation}
        onFocus={buttonFocus.onFocus}
        onBlur={buttonFocus.onBlur}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={busy ? 'Requesting location' : 'Turn on location'}
        style={[styles.secondaryButton, buttonFocus.focused && styles.secondaryButtonFocused]}
      >
        {busy && <Spinner />}
        <Text style={styles.secondaryButtonLabel}>{busy ? 'Requesting…' : 'Turn on location'}</Text>
      </Pressable>
    </View>
  );
}

type AnywherePaneProps = {
  draft: ScopeDraft;
  cityQuery: string;
  onCityQueryChange: (query: string) => void;
  cityFetch: CityFetchState;
  isCityLoading: boolean;
  onSelectCity: (city: CitySuggestion) => void;
  onRemoveCity: (city: CitySuggestion) => void;
  onDistanceChange: (maxDistanceKm: number | null) => void;
};

// City typeahead + selected-city chips copied from AnywhereSearchScreen
// (design-spec.md T2: reuse its city-search code verbatim), plus the
// distance slider — hidden with no anchor at all (anywhereHasAnchor),
// same "Hidden" rule FilterSheet's DistanceSlider already follows.
// ponytail: this duplicates AnywhereSearchScreen's city-search effect/JSX
// rather than extracting a shared hook/component — that screen is deleted
// in T4 once T3/T4 land, so a shared module now would just get un-extracted
// again next task; dedupe only if AnywhereSearchScreen ever outlives T4.
function AnywherePane({
  draft,
  cityQuery,
  onCityQueryChange,
  cityFetch,
  isCityLoading,
  onSelectCity,
  onRemoveCity,
  onDistanceChange,
}: AnywherePaneProps) {
  const trimmedCityQuery = cityQuery.trim();
  const panelState = isCityLoading ? 'loading' : cityFetch.status;

  return (
    <>
      <View style={styles.section}>
        <View style={styles.labelRow}>
          <Text style={styles.sectionLabel}>Cities</Text>
          <Text style={styles.countLabel}>{draft.cities.length} selected</Text>
        </View>
        <View style={styles.inputRow}>
          <Search size={16} color={colors.textMuted} strokeWidth={1.75} />
          <TextInput
            value={cityQuery}
            onChangeText={onCityQueryChange}
            placeholder="Search cities"
            placeholderTextColor={colors.textDisabled}
            style={styles.input}
            accessibilityLabel="Search cities"
          />
          {cityQuery.length > 0 && (
            <Pressable onPress={() => onCityQueryChange('')} accessibilityRole="button" accessibilityLabel="Clear search" style={styles.clearButton}>
              <X size={16} color={colors.textMuted} strokeWidth={1.75} />
            </Pressable>
          )}
        </View>

        {trimmedCityQuery.length > 0 && (
          <View style={styles.resultsPanel}>
            {panelState === 'loading' && [0, 1, 2].map((i) => <Skeleton key={i} width="100%" height={44} style={styles.skeletonRow} />)}
            {panelState === 'results' &&
              cityFetch.results.map((city) => (
                <Pressable
                  key={cityKey(city)}
                  onPress={() => onSelectCity(city)}
                  accessibilityRole="button"
                  accessibilityLabel={`${city.city}, ${city.country}`}
                  style={({ pressed }) => [styles.resultRow, pressed && styles.resultRowActive]}
                >
                  <Text style={styles.resultCity}>{city.city}</Text>
                  <Text style={styles.resultCountry}>{city.country}</Text>
                </Pressable>
              ))}
            {panelState === 'no-match' && (
              <View style={styles.resultMessage}>
                <SearchX size={16} color={colors.textMuted} strokeWidth={1.75} />
                <Text style={styles.resultMessageText}>No cities found</Text>
              </View>
            )}
            {panelState === 'error' && (
              <View style={styles.resultMessage}>
                <Text style={styles.resultErrorText}>{cityFetch.error}</Text>
              </View>
            )}
          </View>
        )}

        {draft.cities.length > 0 && (
          <View style={styles.chipsRow}>
            {draft.cities.map((city) => (
              <FilterChip key={cityKey(city)} variant="remove" label={`${city.city}, ${city.country}`} onPress={() => onRemoveCity(city)} />
            ))}
          </View>
        )}
      </View>

      {anywhereHasAnchor(draft) && <DistanceSlider value={draft.maxDistanceKm} onChange={onDistanceChange} />}
    </>
  );
}

// @react-native-community/slider's published typings don't expose a
// `thumbStyle`/`thumbSize` override that actually reaches its web renderer —
// 20 is that renderer's own fixed thumb size (`constants.THUMB_SIZE`), used
// here only to position the decorative ring, not to resize the real thumb.
const THUMB_SIZE = 20;
const RING_SIZE = THUMB_SIZE + 8;

// design-spec.md T2: one canonical 5-500km range, the top stop (500) itself
// rendering "No limit" — same sentinel-value mechanism as FilterSheet's
// DistanceSlider (a value beyond the "narrowed" range maps to
// maxDistanceKm: null), just with the sentinel being the labeled ceiling
// itself rather than one invisible step past it, per design-spec.md's exact
// "5-500km, 500 renders 'No limit'" wording.
function DistanceSlider({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  const min = MIN_DISTANCE_KM;
  const max = MAX_DISTANCE_KM;
  const sliderValue = value ?? max;
  const isNoLimit = sliderValue >= max;

  const [dragging, setDragging] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const focus = useFocusable();
  const showRing = (dragging || focus.focused) && trackWidth > 0;
  const fraction = (sliderValue - min) / (max - min);
  const thumbCenter = THUMB_SIZE / 2 + fraction * (trackWidth - THUMB_SIZE);

  function handleValueChange(next: number) {
    onChange(next >= max ? null : next);
  }

  return (
    <View style={styles.section}>
      <View style={styles.labelRow}>
        <Text style={styles.sectionLabel}>Max distance</Text>
        <Text style={styles.distanceValue}>{isNoLimit ? 'No limit' : `Within ${sliderValue} km`}</Text>
      </View>
      <View onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}>
        <Slider
          style={styles.slider}
          minimumValue={min}
          maximumValue={max}
          step={DISTANCE_STEP_KM}
          value={sliderValue}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.primary}
          onValueChange={handleValueChange}
          onSlidingStart={() => setDragging(true)}
          onSlidingComplete={() => setDragging(false)}
          onFocus={focus.onFocus}
          onBlur={focus.onBlur}
          accessibilityLabel="Max distance"
          accessibilityValue={{ text: isNoLimit ? 'No limit' : `${sliderValue} kilometres` }}
        />
        {showRing && <View pointerEvents="none" style={[styles.sliderRing, { left: thumbCenter - RING_SIZE / 2 }]} />}
      </View>
      <View style={styles.endLabelsRow}>
        <Text style={styles.endLabel}>{min} km</Text>
        <Text style={styles.endLabel}>No limit</Text>
      </View>
    </View>
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
  section: {
    gap: space[3],
  },
  group: {
    gap: space[3],
  },
  groupLabel: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
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
  countLabel: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  paneText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: fontSize.sm * 1.45,
  },
  rangeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: colors.surfaceHover,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopColor: colors.cardHighlight,
    borderRadius: radius.default,
    padding: space[4],
  },
  rangeTextColumn: {
    flex: 1,
  },
  rangeTitle: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '600',
  },
  rangeSubtitle: {
    marginTop: space[1],
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  fixedBadge: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingVertical: space[1],
    paddingHorizontal: space[2],
  },
  fixedBadgeLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.default,
    paddingHorizontal: space[6],
    alignSelf: 'flex-start',
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
  input: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.text,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  clearButton: {
    width: 44,
    height: 44,
    marginRight: -space[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultsPanel: {
    marginTop: space[2],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 1,
    borderTopColor: colors.cardHighlight,
    borderRadius: radius.default,
    overflow: 'hidden',
  },
  skeletonRow: {
    marginVertical: space[1],
    marginHorizontal: space[2],
  },
  resultRow: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  resultRowActive: {
    backgroundColor: colors.surfaceHover,
  },
  resultCity: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  resultCountry: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  resultMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    paddingVertical: space[4],
  },
  resultMessageText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  resultErrorText: {
    fontSize: fontSize.sm,
    color: colors.error,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    marginTop: space[3],
  },
  distanceValue: {
    fontSize: fontSize.md,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  slider: {
    width: '100%',
    height: 44,
  },
  sliderRing: {
    position: 'absolute',
    top: '50%',
    marginTop: -RING_SIZE / 2,
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 2,
    borderColor: colors.text,
  },
  endLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  endLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
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
