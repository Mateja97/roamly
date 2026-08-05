import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Search, SearchX, X } from 'lucide-react-native';
import type { CitySuggestion } from '../../api/cities';
import { FilterChip } from '../../components/FilterChip';
import { Skeleton } from '../../components/Skeleton';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { DistanceSlider } from './DistanceSlider';
import type { CityFetchState, ScopeDraft } from './scopeDraft';
import { anywhereHasAnchor, cityKey } from './scopeDraft';
import { scopeSheetStyles } from './scopeSheetStyles';

export type AnywherePaneProps = {
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
// ponytail: the city-search effect already got extracted into the shared
// `useCitySearch` hook (T13) — this file owns zero effects now. What's
// still deferred is the JSX below (input row, results panel, city chips):
// it stays inline here rather than a shared component, since this is the
// one remaining consumer (`AnywhereSearchScreen`, the other, was deleted
// in T4); extract a shared component only if a second consumer shows up.
export function AnywherePane({
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
      <View style={scopeSheetStyles.section}>
        <View style={scopeSheetStyles.labelRow}>
          <Text style={scopeSheetStyles.sectionLabel}>Cities</Text>
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
          <View style={styles.cityChipsRow}>
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

const styles = StyleSheet.create({
  countLabel: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
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
  // Unlike FilterGroup's own `chipsRow` (gapped by its parent `group`
  // style), this row isn't inside a `group`-gapped container, so it keeps
  // its own top margin here.
  cityChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    marginTop: space[3],
  },
});
