import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { ChevronLeft, Globe, Search, SearchX, X } from 'lucide-react-native';
import type { Activity } from '../../api/activities';
import { queryActivities } from '../../api/activities';
import type { CitySuggestion } from '../../api/cities';
import { suggestCities } from '../../api/cities';
import { FilterChip } from '../../components/FilterChip';
import { Skeleton } from '../../components/Skeleton';
import { Spinner } from '../../components/Spinner';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { CATEGORY_OPTIONS } from '../activity-list/filters';
import type { Category } from '../activity-list/types';
import type { ScopeSelection } from '../scope-picker/types';
import {
  MAX_DISTANCE_KM,
  MIN_DISTANCE_KM,
  buildAnywhereSearchRequest,
  defaultAnywhereSearchState,
  isAnywhereSearchDefault,
} from './anywhereSearch';
import type { AnywhereSearchState } from './anywhereSearch';

type AnywhereSearchScreenProps = {
  selection: ScopeSelection;
  onBack: () => void;
  onSearchComplete: (activities: Activity[], categories: Category[]) => void;
};

// The debounce window for both the city typeahead and the live result-count
// re-query — small enough to feel live, large enough not to fire on every
// keystroke/drag tick.
const DEBOUNCE_MS = 300;

type ResultsPanelState = 'loading' | 'results' | 'no-match' | 'error';

// design-spec.md T5: shares T6's shell (header/title/activities/footer) and
// adds the Max distance slider + Cities typeahead. See design-spec.md's T5
// section for the full states list this implements.
export function AnywhereSearchScreen({ selection, onBack, onSearchComplete }: AnywhereSearchScreenProps) {
  const [state, setState] = useState<AnywhereSearchState>(defaultAnywhereSearchState());
  // Last-known result count for the CTA — kept during a re-query so the
  // button never blanks (design-spec.md's "live CTA count" rule). `null`
  // only until the very first (mount) query resolves.
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [cityQuery, setCityQuery] = useState('');
  // Keyed on the query it was fetched for, so "loading" (a query with no
  // matching fetch yet) is derived at render time rather than set
  // synchronously inside the effect below (see the effect's comment).
  const [cityFetch, setCityFetch] = useState<{ query: string; status: Exclude<ResultsPanelState, 'loading'>; results: CitySuggestion[]; error: string | null }>(
    { query: '', status: 'no-match', results: [], error: null }
  );

  const insets = useSafeAreaInsets();
  const backFocus = useFocusable();
  const resetFocus = useFocusable();
  const ctaFocus = useFocusable();
  const requestSeq = useRef(0);

  // Live count: re-query on every distance/city/category change, debounced.
  // Ignores its own failures (silently keeps the last known count) — only
  // the explicit "Show" action surfaces an error banner, per design-spec.md.
  useEffect(() => {
    const seq = ++requestSeq.current;
    const timer = setTimeout(() => {
      queryActivities(buildAnywhereSearchRequest(selection, state)).then((result) => {
        if (requestSeq.current !== seq) return; // superseded by a newer change
        if (result.status === 'success') setActivities(result.activities);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selection is stable for the screen's lifetime
  }, [state]);

  // City typeahead — debounced against T4's endpoint. Only ever calls
  // setState from inside the async callback (never synchronously in the
  // effect body) — "loading" is derived at render time instead, by
  // comparing the trimmed query against the query `cityFetch` was last
  // fetched for (see `isCityLoading` below).
  useEffect(() => {
    const query = cityQuery.trim();
    if (query.length === 0) return;
    const timer = setTimeout(() => {
      suggestCities(query).then((result) => {
        if (result.status !== 'success') {
          setCityFetch({ query, status: 'error', results: [], error: result.message });
          return;
        }
        const selectedKeys = new Set(state.cities.map(cityKey));
        const suggestions = result.suggestions.filter((s) => !selectedKeys.has(cityKey(s)));
        setCityFetch({ query, status: suggestions.length === 0 ? 'no-match' : 'results', results: suggestions, error: null });
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [cityQuery, state.cities]);

  function selectCity(city: CitySuggestion) {
    setState((prev) => ({ ...prev, cities: [...prev.cities, city] }));
    setCityQuery('');
  }

  function removeCity(city: CitySuggestion) {
    setState((prev) => ({ ...prev, cities: prev.cities.filter((c) => cityKey(c) !== cityKey(city)) }));
  }

  function toggleCategory(category: Category) {
    setState((prev) => ({
      ...prev,
      categories: prev.categories.includes(category)
        ? prev.categories.filter((c) => c !== category)
        : [...prev.categories, category],
    }));
  }

  function handleReset() {
    setState(defaultAnywhereSearchState());
    setCityQuery('');
    setSubmitError(null);
  }

  async function handleSearch() {
    setSubmitting(true);
    setSubmitError(null);
    const result = await queryActivities(buildAnywhereSearchRequest(selection, state));
    setSubmitting(false);
    if (result.status === 'success') {
      setActivities(result.activities);
      onSearchComplete(result.activities, state.categories);
    } else {
      setSubmitError(result.message);
    }
  }

  const count = activities?.length ?? null;
  const zeroResult = count === 0;
  const ctaDisabled = submitting || count === null || zeroResult;
  const ctaLabel = submitting ? 'Searching…' : count === null ? 'Show activities' : `Show ${count} ${count === 1 ? 'activity' : 'activities'}`;
  const resetDisabled = isAnywhereSearchDefault(state);

  const trimmedCityQuery = cityQuery.trim();
  const isCityLoading = trimmedCityQuery.length > 0 && cityFetch.query !== trimmedCityQuery;
  const panelState: ResultsPanelState = isCityLoading ? 'loading' : cityFetch.status;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          onFocus={backFocus.onFocus}
          onBlur={backFocus.onBlur}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={[styles.backButton, backFocus.focused && styles.backButtonFocused]}
        >
          <ChevronLeft size={16} color={colors.textMuted} strokeWidth={1.75} />
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
        <View style={styles.scopePill} accessible accessibilityLabel="Scope: Anywhere">
          <Globe size={16} color={colors.textMuted} strokeWidth={1.75} />
          <Text style={styles.scopePillLabel}>Anywhere</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Refine your search</Text>
          <Text style={styles.subtitle}>Set a distance, pick cities, and choose what you&apos;re into.</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Text style={styles.sectionLabel}>MAX DISTANCE</Text>
            <Text style={styles.distanceValue}>{state.maxDistanceKm} km</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={MIN_DISTANCE_KM}
            maximumValue={MAX_DISTANCE_KM}
            step={5}
            value={state.maxDistanceKm}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.primary}
            onValueChange={(maxDistanceKm) => setState((prev) => ({ ...prev, maxDistanceKm }))}
            accessibilityLabel="Max distance"
            accessibilityValue={{ text: `${state.maxDistanceKm} kilometres` }}
          />
          <View style={styles.endLabelsRow}>
            <Text style={styles.endLabel}>{MIN_DISTANCE_KM} km</Text>
            <Text style={styles.endLabel}>{MAX_DISTANCE_KM} km</Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Text style={styles.sectionLabel}>CITIES</Text>
            <Text style={styles.countLabel}>{state.cities.length} selected</Text>
          </View>
          <View style={styles.inputRow}>
            <Search size={16} color={colors.textMuted} strokeWidth={1.75} />
            <TextInput
              value={cityQuery}
              onChangeText={setCityQuery}
              placeholder="Search cities"
              placeholderTextColor={colors.textDisabled}
              style={styles.input}
              accessibilityLabel="Search cities"
            />
            {cityQuery.length > 0 && (
              <Pressable
                onPress={() => setCityQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                style={styles.clearButton}
              >
                <X size={16} color={colors.textMuted} strokeWidth={1.75} />
              </Pressable>
            )}
          </View>

          {trimmedCityQuery.length > 0 && (
            <View style={styles.resultsPanel}>
              {panelState === 'loading' &&
                [0, 1, 2].map((i) => <Skeleton key={i} width="100%" height={44} style={styles.skeletonRow} />)}
              {panelState === 'results' &&
                cityFetch.results.map((city) => (
                  <Pressable
                    key={cityKey(city)}
                    onPress={() => selectCity(city)}
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

          {state.cities.length > 0 && (
            <View style={styles.chipsRow}>
              {state.cities.map((city) => (
                <FilterChip key={cityKey(city)} variant="remove" label={`${city.city}, ${city.country}`} onPress={() => removeCity(city)} />
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Text style={styles.sectionLabel}>ACTIVITIES</Text>
            <Text style={styles.countLabel}>{state.categories.length} selected</Text>
          </View>
          <View style={styles.chipsRow}>
            {CATEGORY_OPTIONS.map((option) => (
              <FilterChip
                key={option.value}
                variant="select"
                label={option.label}
                selected={state.categories.includes(option.value)}
                onPress={() => toggleCategory(option.value)}
              />
            ))}
          </View>
        </View>

        <View style={styles.errorRegion}>
          {submitError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{submitError}</Text>
              <Pressable onPress={() => setSubmitError(null)} accessibilityRole="button" accessibilityLabel="Dismiss error" style={styles.dismissButton}>
                <X size={16} color={colors.error} strokeWidth={1.75} />
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: space[4] + insets.bottom }]}>
        <Pressable
          onPress={handleReset}
          onFocus={resetFocus.onFocus}
          onBlur={resetFocus.onBlur}
          disabled={resetDisabled}
          accessibilityRole="button"
          accessibilityLabel="Reset"
          style={[styles.resetButton, resetFocus.focused && !resetDisabled && styles.resetButtonFocused]}
        >
          <Text style={[styles.resetLabel, resetDisabled && styles.disabledLabel]}>Reset</Text>
        </Pressable>
        <Pressable
          onPress={handleSearch}
          onFocus={ctaFocus.onFocus}
          onBlur={ctaFocus.onBlur}
          disabled={ctaDisabled}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          style={[styles.ctaButton, ctaFocus.focused && styles.ctaButtonFocused, ctaDisabled && !submitting && styles.ctaButtonDisabled]}
        >
          {submitting && <Spinner />}
          <Text style={[styles.ctaLabel, ctaDisabled && !submitting && styles.disabledLabel]}>{ctaLabel}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function cityKey(city: CitySuggestion): string {
  return `${city.city}|${city.country}`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space[4],
    paddingHorizontal: space[6],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    minHeight: 44,
    paddingHorizontal: space[2],
    borderRadius: radius.default,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  backButtonFocused: {
    backgroundColor: colors.surfaceHover,
  },
  backLabel: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  scopePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  scopePillLabel: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  scroll: {
    paddingHorizontal: space[6],
    paddingBottom: space[6],
  },
  titleBlock: {
    paddingTop: space[6],
  },
  title: {
    fontSize: fontSize.xl,
    color: colors.text,
    fontWeight: '600',
    lineHeight: fontSize.xl * 1.2,
  },
  subtitle: {
    marginTop: space[2],
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: fontSize.sm * 1.5,
  },
  section: {
    marginTop: space[8],
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  countLabel: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  distanceValue: {
    fontSize: fontSize.md,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  slider: {
    width: '100%',
    height: 44,
    marginTop: space[3],
  },
  endLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  endLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginTop: space[3],
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
  errorRegion: {
    marginTop: space[6],
    minHeight: 1,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.default,
    padding: space[3],
  },
  errorText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.error,
  },
  dismissButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    flexDirection: 'row',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingTop: space[4],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  resetButton: {
    minHeight: 44,
    paddingHorizontal: space[6],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.default,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  resetButtonFocused: {
    backgroundColor: colors.surfaceHover,
  },
  resetLabel: {
    fontSize: fontSize.md,
    color: colors.textMuted,
    fontWeight: '500',
  },
  ctaButton: {
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
  ctaButtonFocused: {
    borderColor: colors.text,
  },
  ctaButtonDisabled: {
    backgroundColor: colors.surfaceHover,
  },
  ctaLabel: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  disabledLabel: {
    color: colors.textDisabled,
  },
});
