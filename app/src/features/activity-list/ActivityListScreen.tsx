import { useCallback, useEffect, useRef, useState } from 'react';
import type { ElementRef } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  findNodeHandle,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SearchX, SlidersHorizontal } from 'lucide-react-native';
import type { Activity, ActivitiesQueryResult } from '../../api/activities';
import { queryActivities } from '../../api/activities';
import { ActivityCard, ActivityCardSkeleton } from '../../components/ActivityCard';
import { FilterChip } from '../../components/FilterChip';
import { Skeleton } from '../../components/Skeleton';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { FilterSheet } from './FilterSheet';
import { EMPTY_FILTERS, SCOPE_TITLES, activeFilterCount, buildActivitiesRequest, filterChips } from './filters';
import type { ActivityListScreenProps, Filters } from './types';

// Country (outside_country) scope header subtitle — static (doesn't wait on
// the fetch) per design-spec.md's T6 section. The title reads
// `selection.homeCountry`, the place T4's Location screen confirmed before
// this screen ever mounts (App.tsx always routes outside_country through it
// first). ponytail: the spec's "no name resolvable" fallback (generic title,
// country folded into the subtitle) is skipped — the Location screen always
// resolves a name (search result or its own default place), so `homeCountry`
// is never empty in practice; the `?? SCOPE_TITLES.outside_country` fallback
// below exists only to satisfy the optional type, not a reachable UI state.
const COUNTRY_HEADER_SUBTITLE = 'Top-rated activities';

type QueryState =
  | { status: 'loading' }
  | { status: 'loaded'; activities: Activity[] }
  | { status: 'empty' }
  | { status: 'error'; message: string };

const SKELETON_CARD_COUNT = 5;

export function ActivityListScreen({ selection, initialCategories = [], onBack }: ActivityListScreenProps) {
  // T2: the types-picker screen carries its selection in as the initial
  // applied filter, so the first query arrives pre-filtered. Frozen via
  // useState's lazy initializer (runs once, on mount) rather than reading
  // the `initialCategories` prop directly in the effect below — a parent
  // re-render passing a fresh empty-array default won't retrigger it.
  const [initialFilters] = useState<Filters>(() => ({ ...EMPTY_FILTERS, categories: initialCategories }));
  const [appliedFilters, setAppliedFilters] = useState<Filters>(initialFilters);
  const [queryState, setQueryState] = useState<QueryState>({ status: 'loading' });
  const [sheetVisible, setSheetVisible] = useState(false);
  const filtersButtonRef = useRef<ElementRef<typeof Pressable>>(null);
  const countRef = useRef<View>(null);

  const runQuery = useCallback(
    (filters: Filters): Promise<ActivitiesQueryResult> => queryActivities(buildActivitiesRequest(selection, filters)),
    [selection]
  );

  function applyResult(result: ActivitiesQueryResult) {
    if (result.status === 'success') {
      setQueryState(
        result.activities.length === 0 ? { status: 'empty' } : { status: 'loaded', activities: result.activities }
      );
    } else {
      setQueryState({ status: 'error', message: result.message });
    }
  }

  // Initial load — fires once per mount (once per scope selection). Applying
  // filters or removing a chip re-queries explicitly below, not via effect.
  // `queryState`'s own default is already `{status: 'loading'}`, so there's
  // no state to set synchronously here — just kick off the fetch.
  useEffect(() => {
    let cancelled = false;
    runQuery(initialFilters).then((result) => {
      if (!cancelled) applyResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, [runQuery, initialFilters]);

  // design-spec.md requires the platform-native back control/gesture, not a
  // custom on-screen button — but T3/T4 deliberately have no stack
  // navigator yet (see App.tsx), so there's no navigator-provided gesture
  // to defer to either. Android's hardware back button is itself a native
  // platform affordance (RN's BackHandler), not a custom control, so it's
  // wired here.
  // ponytail: iOS has no equivalent without a navigator (BackHandler is a
  // no-op on iOS) — no back path exists there today. Accepted per
  // DESIGN_STANDARDS.md's own "Navigation patterns... no router yet"
  // deferral; add a router (and this becomes free on both platforms) once a
  // third screen/back-stack need shows up. See engineering-notes.md.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  function focusCount() {
    const handle = countRef.current && findNodeHandle(countRef.current);
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
  }

  // Direct chip removal / "Clear filters" — updates the applied set
  // immediately and re-queries; a failure here shows the generic Fetch
  // error state (no sheet involved to scope it to).
  async function handleFiltersChange(next: Filters) {
    setAppliedFilters(next);
    setQueryState({ status: 'loading' });
    const result = await runQuery(next);
    applyResult(result);
    // ponytail: focus always lands on the result count rather than tracking
    // "the next chip" precisely — chip order/refs shift on every removal,
    // and the count line is always present and reachable.
    focusCount();
  }

  async function handleRetry() {
    setQueryState({ status: 'loading' });
    const result = await runQuery(appliedFilters);
    applyResult(result);
  }

  // Sheet-scoped Apply — the list shows the re-query skeleton while it runs
  // (per design-spec), but only commits new results/applied filters on
  // success; on failure the list reverts to what it had and the sheet
  // surfaces its own error, leaving the draft selection intact.
  async function handleApply(draft: Filters): Promise<ActivitiesQueryResult> {
    const previousState = queryState;
    setQueryState({ status: 'loading' });
    const result = await runQuery(draft);
    if (result.status === 'success') {
      setAppliedFilters(draft);
      applyResult(result);
    } else {
      setQueryState(previousState);
    }
    return result;
  }

  function closeSheet() {
    setSheetVisible(false);
    filtersButtonRef.current?.focus?.();
  }

  const chips = filterChips(appliedFilters);
  const filterCount = activeFilterCount(appliedFilters);
  const resultCount = queryState.status === 'loaded' ? queryState.activities.length : queryState.status === 'empty' ? 0 : null;
  const showDistance = selection.scope !== 'outside_country';
  const filtersFocus = useFocusable();

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerTitleBlock}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {selection.scope === 'outside_country'
              ? selection.homeCountry ?? SCOPE_TITLES.outside_country
              : SCOPE_TITLES[selection.scope]}
          </Text>
          {selection.scope === 'outside_country' && (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {COUNTRY_HEADER_SUBTITLE}
            </Text>
          )}
        </View>
        <Pressable
          ref={filtersButtonRef}
          onPress={() => setSheetVisible(true)}
          onFocus={filtersFocus.onFocus}
          onBlur={filtersFocus.onBlur}
          accessibilityRole="button"
          accessibilityLabel={filterCount > 0 ? `Filters, ${filterCount} active` : 'Filters'}
          style={[styles.filtersButton, filtersFocus.focused && styles.filtersButtonFocused]}
        >
          <SlidersHorizontal size={16} color={colors.text} strokeWidth={1.75} />
          <Text style={styles.filtersButtonLabel}>Filters</Text>
          {filterCount > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeLabel}>{filterCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      <View style={styles.resultRegion}>
        <View ref={countRef} accessible accessibilityLiveRegion="polite">
          {resultCount === null ? (
            <Skeleton width={90} height={16} />
          ) : (
            <Text style={styles.resultCount}>
              {resultCount} {resultCount === 1 ? 'activity' : 'activities'}
            </Text>
          )}
        </View>
        {chips.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {chips.map((chip) => (
              <FilterChip key={chip.key} variant="remove" label={chip.label} onPress={() => handleFiltersChange(chip.remove())} />
            ))}
          </ScrollView>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {queryState.status === 'loading' &&
          Array.from({ length: SKELETON_CARD_COUNT }).map((_, i) => <ActivityCardSkeleton key={i} />)}

        {queryState.status === 'loaded' &&
          queryState.activities.map((activity) => (
            <ActivityCard key={activity.id} activity={activity} showDistance={showDistance} />
          ))}

        {queryState.status === 'empty' && (
          <EmptyState hasFilters={filterCount > 0} onClearFilters={() => handleFiltersChange(EMPTY_FILTERS)} />
        )}

        {queryState.status === 'error' && <ErrorState message={queryState.message} onRetry={handleRetry} />}
      </ScrollView>

      {/* Keyed on open/closed so each open is a fresh mount — the sheet reads
          `appliedFilters` as its initial draft once, rather than needing an
          effect to resync it on every re-open (see FilterSheet). */}
      <FilterSheet
        key={sheetVisible ? 'open' : 'closed'}
        visible={sheetVisible}
        initialFilters={appliedFilters}
        scope={selection.scope}
        onApply={handleApply}
        onClose={closeSheet}
      />
    </SafeAreaView>
  );
}

function EmptyState({ hasFilters, onClearFilters }: { hasFilters: boolean; onClearFilters: () => void }) {
  const focus = useFocusable();
  return (
    <View style={styles.emptyState}>
      <SearchX size={20} color={colors.textMuted} strokeWidth={1.75} />
      <Text style={styles.emptyTitle}>No activities match</Text>
      <Text style={styles.emptyHint}>
        {hasFilters ? 'Try removing a filter or widening your distance.' : 'Nothing here right now.'}
      </Text>
      {hasFilters && (
        <Pressable
          onPress={onClearFilters}
          onFocus={focus.onFocus}
          onBlur={focus.onBlur}
          accessibilityRole="button"
          accessibilityLabel="Clear filters"
          style={[styles.secondaryButton, focus.focused && styles.secondaryButtonFocused]}
        >
          <Text style={styles.secondaryButtonLabel}>Clear filters</Text>
        </Pressable>
      )}
    </View>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
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
        style={[styles.secondaryButton, focus.focused && styles.secondaryButtonFocused]}
      >
        <Text style={styles.secondaryButtonLabel}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    paddingVertical: space[4],
    paddingHorizontal: space[6],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitleBlock: {
    flex: 1,
  },
  headerTitle: {
    fontSize: fontSize.lg,
    color: colors.text,
    fontWeight: '500',
  },
  headerSubtitle: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  filtersButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.default,
    paddingHorizontal: space[4],
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  filtersButtonFocused: {
    backgroundColor: colors.surfaceHover,
    borderColor: colors.primary,
  },
  filtersButtonLabel: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: '500',
  },
  countBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[1],
  },
  countBadgeLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.ink,
  },
  resultRegion: {
    paddingTop: space[4],
    paddingHorizontal: space[4],
    gap: space[2],
  },
  resultCount: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  chipRow: {
    gap: space[2],
  },
  list: {
    padding: space[4],
    gap: space[4],
    paddingBottom: space[6],
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
