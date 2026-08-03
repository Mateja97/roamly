import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SearchX } from 'lucide-react-native';
import type { Activity, ActivitiesQueryResult } from '../../api/activities';
import { queryActivities } from '../../api/activities';
import { ActivityCard, ActivityCardSkeleton } from '../../components/ActivityCard';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { ActivityDetailScreen } from './ActivityDetailScreen';
import { tripadvisorAttribution } from './activityDetailConfig';
import { CategoryRow } from './CategoryRow';
import { orderCategories } from './categoryOrder';
import { FeedHeader } from './FeedHeader';
import {
  CATEGORY_OPTIONS,
  buildFeedRequest,
  clearCategories,
  defaultFilters,
  filterBySubtypes,
  subtypeCounts,
  toggleCategory,
} from './filters';
import { NearbyNudgeCard } from './NearbyNudgeCard';
import { dismissNearbyNudge, isNearbyNudgeDismissed } from './nearbyNudge';
import { SubtypeRail } from './SubtypeRail';
import { TravelerRow } from './TravelerRow';
import type { TravelerRowState } from './TravelerRow';
import { getHomeBaseSamples, homeBaseMedian, isTraveler, recordHomeBaseSample } from './travelerMode';
import type { ActivityListScreenProps, Category, Filters } from './types';
import { useNearbyLocation } from '../scope-picker/useNearbyLocation';
import { ScopeSheet } from '../scope-sheet/ScopeSheet';
import { defaultScopeDraft } from '../scope-sheet/scopeDraft';
import type { ScopeDraft } from '../scope-sheet/scopeDraft';

type QueryState =
  | { status: 'loading' }
  | { status: 'loaded'; activities: Activity[] }
  | { status: 'error'; message: string };

const SKELETON_CARD_COUNT = 5;
// design-spec.md T3: Traveler mode's curated row.
const TRAVELER_CATEGORIES: Category[] = ['tours_experiences', 'culture'];
const TRAVELER_ROW_CAP = 8;

export function ActivityListScreen({
  selection,
  initialCategories = [],
  initialActivities,
  initialCities = [],
  onBack,
}: ActivityListScreenProps) {
  // T2/T3: frozen via useState's lazy initializer (runs once, on mount) —
  // a parent re-render passing fresh prop defaults won't retrigger these.
  const [appliedFilters, setAppliedFilters] = useState<Filters>(() => ({
    ...defaultFilters(selection.scope),
    categories: initialCategories,
  }));
  // design-spec.md T3: scope/city/distance/rating now live here (T2's
  // ScopeDraft), not on `Filters` — seeded from the props the caller (still
  // the pre-T4 scope-picker flow) hands in.
  const [appliedScopeDraft, setAppliedScopeDraft] = useState<ScopeDraft>(() => ({
    ...defaultScopeDraft(selection.scope, selection.coordinates),
    cities: initialCities,
  }));
  const [queryState, setQueryState] = useState<QueryState>(() =>
    initialActivities !== undefined ? { status: 'loaded', activities: initialActivities } : { status: 'loading' }
  );
  // The subtype rail's counts read from this, not from `queryState`
  // directly — `queryState` collapses to no-activities during a refetch or
  // on error, which would otherwise zero every subtype's count and disable
  // it (including a chip the user has *selected*, trapping them). This only
  // ever updates on a successful fetch, so it holds the last real data
  // across any loading/error state in between.
  const [lastLoadedActivities, setLastLoadedActivities] = useState<Activity[]>(() => initialActivities ?? []);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const filtersRequestSeq = useRef(0);
  const [retryEpoch, setRetryEpoch] = useState(0);
  // design-spec.md T3: "recomputed on screen focus only... selecting a
  // category must not reorder the row." This app has no router (see
  // App.tsx), so "focus" has no native lifecycle event here — the nearest
  // real analogs are: mount, returning from the Detail overlay, and closing
  // the Scope sheet (the only other "screens" this app has today). See
  // `refreshAdaptivity` below.
  const [hourAtLastFocus, setHourAtLastFocus] = useState(() => new Date().getHours());
  const [travelerMode, setTravelerMode] = useState(false);
  const [travelerRowState, setTravelerRowState] = useState<TravelerRowState>({ status: 'omit' });
  const [nudgeDismissed, setNudgeDismissed] = useState(true); // starts hidden to avoid a flash before the stored flag resolves
  const nearby = useNearbyLocation();

  function startQuery(): number {
    return ++filtersRequestSeq.current;
  }
  function isCurrent(seq: number): boolean {
    return seq === filtersRequestSeq.current;
  }

  function applyResult(result: ActivitiesQueryResult) {
    if (result.status === 'success') {
      setQueryState({ status: 'loaded', activities: result.activities });
      setLastLoadedActivities(result.activities);
    } else {
      setQueryState({ status: 'error', message: result.message });
    }
  }

  // design-spec.md T3: one reactive query path — scope/city/distance/rating
  // changes (ScopeSheet apply) and category changes (pill row) both funnel
  // through here, replacing the old component's four near-duplicate
  // handlers (handleFiltersChange/handleApply/handleRetry/mount-effect),
  // each of which re-implemented the same isCurrent/seq guard. Subtype
  // toggles never touch `appliedFilters.categories`'s array reference (see
  // handleToggleSubtype below), so they never trigger a re-fetch — they're
  // filtered client-side from the already-fetched, category-scoped result
  // (filters.ts's filterBySubtypes/subtypeCounts).
  const skipFirstFetch = useRef(initialActivities !== undefined);
  useEffect(() => {
    if (skipFirstFetch.current) {
      skipFirstFetch.current = false;
      return;
    }
    const seq = startQuery();
    setQueryState({ status: 'loading' });
    queryActivities(buildFeedRequest(appliedScopeDraft, appliedFilters.categories)).then((result) => {
      if (isCurrent(seq)) applyResult(result);
    });
  }, [appliedScopeDraft, appliedFilters.categories, retryEpoch]);

  // Traveler mode's own curated row — a second, independent query scoped to
  // Tours & Experiences + Culture, silently omitted on error/empty (Fact
  // chip grid's precedent: no error UI for a bonus, decorative section).
  // `travelerRowState` only ever holds a loading/loaded snapshot from the
  // last time traveler mode was actually on — rendering already gates on
  // `travelerMode &&` at every call site, so a stale loaded/loading value
  // left over from a prior traveler-mode-true period is never shown once
  // traveler mode turns back off.
  const travelerRequestSeq = useRef(0);
  useEffect(() => {
    if (!travelerMode) return;
    const seq = ++travelerRequestSeq.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicking off a fetch needs its "loading" flag set before the async call starts, same shape as the query effect just above (which this same rule doesn't flag) — a real difference in the rule's own heuristics, not in the code's correctness.
    setTravelerRowState({ status: 'loading' });
    queryActivities(buildFeedRequest(appliedScopeDraft, TRAVELER_CATEGORIES)).then((result) => {
      if (travelerRequestSeq.current !== seq) return; // superseded by a newer traveler-mode/scope change
      setTravelerRowState(
        result.status === 'success'
          ? { status: 'loaded', activities: result.activities.slice(0, TRAVELER_ROW_CAP) }
          : { status: 'omit' }
      );
    });
  }, [travelerMode, appliedScopeDraft]);

  // design-spec.md's Adaptivity rules: a fresh granted device-location fix
  // (present at mount for Nearby, or handed back by the Scope sheet)
  // contributes to the rolling home-base sample set.
  useEffect(() => {
    if (appliedScopeDraft.coordinates) recordHomeBaseSample(appliedScopeDraft.coordinates);
  }, [appliedScopeDraft.coordinates]);

  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  // Shared by the mount check below and the closeDetail/closeSheet "focus
  // regained" handlers — only the traveler-mode async check lives here
  // (setTravelerMode fires from its .then callback, not synchronously).
  // `hourAtLastFocus` itself is set separately by each interactive call
  // site — the mount case already has the right value from its own useState
  // lazy initializer above, so it doesn't need to be re-set here too.
  function checkTravelerMode(currentCoordinates: ScopeDraft['coordinates']) {
    getHomeBaseSamples().then((samples) => {
      if (!mountedRef.current) return; // avoids a post-unmount setState (e.g. a test that unmounts before this microtask settles)
      setTravelerMode(isTraveler(currentCoordinates, homeBaseMedian(samples)));
    });
  }

  function refreshAdaptivity(currentCoordinates: ScopeDraft['coordinates']) {
    setHourAtLastFocus(new Date().getHours());
    checkTravelerMode(currentCoordinates);
  }

  useEffect(() => {
    checkTravelerMode(appliedScopeDraft.coordinates);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only traveler check; hourAtLastFocus's own useState initializer already covers the "at mount" value
  }, []);

  // design-spec.md T3: nudge dismissal check + permission-status check both
  // only matter once scope is unanchored Anywhere.
  useEffect(() => {
    isNearbyNudgeDismissed().then(setNudgeDismissed);
  }, []);
  useEffect(() => {
    if (appliedScopeDraft.scope !== 'anywhere' || appliedScopeDraft.coordinates) return;
    // If permission was already granted (e.g. in an earlier session/screen),
    // `requestLocation` never shows an OS prompt for an already-granted
    // permission — it just resolves the fix quietly. Without this, a user
    // who'd already granted location would still see the "Turn on location"
    // nudge forever, since nothing here had ever actually fetched a fix.
    nearby.checkPermission().then((granted) => {
      if (!granted) return;
      nearby.requestLocation().then((coordinates) => {
        if (coordinates) setAppliedScopeDraft((prev) => ({ ...prev, coordinates }));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nearby.checkPermission/requestLocation identities are stable (useCallback, no deps)
  }, [appliedScopeDraft.scope, appliedScopeDraft.coordinates]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedActivity) {
        closeDetail();
      } else {
        onBack();
      }
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeDetail reads current state via closure; re-subscribing on every selectedActivity change keeps the handler current
  }, [onBack, selectedActivity]);

  function closeDetail() {
    setSelectedActivity(null);
    refreshAdaptivity(appliedScopeDraft.coordinates);
  }

  function handleToggleCategory(category: Category) {
    setAppliedFilters((prev) => toggleCategory(prev, category));
  }

  function handleClearCategories() {
    setAppliedFilters((prev) => clearCategories(prev));
  }

  // Subtypes are client-filtered (see the query effect's comment above) —
  // toggling one never re-fetches, it only changes what's shown/counted
  // from the activities already in hand.
  function handleToggleSubtype(subtype: string) {
    setAppliedFilters((prev) => ({
      ...prev,
      subtypes: prev.subtypes.includes(subtype) ? prev.subtypes.filter((s) => s !== subtype) : [...prev.subtypes, subtype],
    }));
  }

  function handleRetry() {
    setRetryEpoch((e) => e + 1);
  }

  function closeSheet() {
    setSheetVisible(false);
    refreshAdaptivity(appliedScopeDraft.coordinates);
  }

  function handleDismissNudge() {
    setNudgeDismissed(true);
    dismissNearbyNudge();
  }

  const hasLocationAnchor = Boolean(appliedScopeDraft.coordinates);
  const hasFilters = appliedFilters.categories.length > 0 || appliedFilters.subtypes.length > 0;
  const order = orderCategories(hourAtLastFocus, travelerMode);
  const selectedCategoryOptions = CATEGORY_OPTIONS.filter((o) => appliedFilters.categories.includes(o.value));

  // design-spec.md T3: "unanchored Anywhere" — no device location AND no
  // city already chosen (a city alone is a perfectly valid, anchored
  // Anywhere state; the nudge is about *never having anchored at all*, not
  // merely "no device coordinates").
  const unanchoredAnywhere =
    appliedScopeDraft.scope === 'anywhere' && !appliedScopeDraft.coordinates && appliedScopeDraft.cities.length === 0;
  // 'locating'/'requesting-permission' only happen transiently while the
  // effect above is silently resolving an already-granted permission's fix
  // — neither nudge shows during that brief window (showing "Turn on
  // location" would be actively wrong: it's already on). 'idle' covers both
  // "not asked yet" and "briefly, before the mount check resolves".
  const showAskNudge =
    unanchoredAnywhere &&
    !nudgeDismissed &&
    (nearby.state.status === 'idle' || nearby.state.status === 'unavailable');
  const showCityNudge = unanchoredAnywhere && nearby.state.status === 'denied';

  const renderItem = useCallback(
    ({ item }: { item: Activity }) => (
      <ActivityCard activity={item} showDistance={hasLocationAnchor} onPress={() => setSelectedActivity(item)} />
    ),
    [hasLocationAnchor]
  );
  const keyExtractor = useCallback((item: Activity) => item.id, []);

  const categoryScopedActivities = queryState.status === 'loaded' ? queryState.activities : [];
  const displayActivities = filterBySubtypes(categoryScopedActivities, appliedFilters);

  const nudge = showAskNudge ? (
    <NearbyNudgeCard variant="ask" onOpenScope={() => setSheetVisible(true)} onDismiss={handleDismissNudge} />
  ) : showCityNudge ? (
    <NearbyNudgeCard variant="choose-city" onOpenScope={() => setSheetVisible(true)} />
  ) : null;

  return (
    <View style={styles.container}>
      <SafeAreaView
        style={styles.screen}
        accessibilityElementsHidden={selectedActivity !== null}
        importantForAccessibility={selectedActivity !== null ? 'no-hide-descendants' : 'auto'}
      >
        {/* ponytail: design-spec.md's "header + context line collapse on
            scroll; pill row + subtype rail stay sticky" describes an
            animated collapsing-header behavior this codebase has no
            existing precedent for (today's header/FilterSheet/ScopeSheet are
            all static or modal, never a scroll-driven collapse) and
            product-tasks.md's own T3 acceptance criteria never lists it as a
            gate. Shipped as a static header instead, matching today's
            already-shipped header pattern — the category row/subtype rail
            read as "sticky" in the strongest sense (they never leave the
            screen at all, stronger than a collapsing-header animation's
            sticky-after-collapse). Upgrade path: an Animated.ScrollView +
            interpolated header height, if this is flagged as a real gap. */}
        <View style={styles.header}>
          {/* `hourAtLastFocus`, not a live `new Date().getHours()` — the
              pill row's own order is frozen to this same value (see
              `refreshAdaptivity`), so the context line and the row never
              disagree across an hour-bucket boundary mid-session. */}
          <FeedHeader
            scope={appliedScopeDraft.scope}
            cities={appliedScopeDraft.cities}
            hour={hourAtLastFocus}
            travelerMode={travelerMode}
            onOpenScope={() => setSheetVisible(true)}
          />
          <CategoryRow
            order={order}
            selected={appliedFilters.categories}
            onToggle={handleToggleCategory}
            onClearAll={handleClearCategories}
          />
          {selectedCategoryOptions.map((option) => (
            <SubtypeRail
              key={option.value}
              category={option.value}
              counts={subtypeCounts(lastLoadedActivities, option.value)}
              selectedSubtypes={appliedFilters.subtypes}
              onToggle={handleToggleSubtype}
            />
          ))}
        </View>

        {queryState.status === 'loaded' && displayActivities.length > 0 ? (
          // T1: only the loaded-results case needs virtualization — an
          // image-heavy list can grow large. Loading/empty/error render a
          // handful of fixed elements, so a plain ScrollView below is plenty.
          <FlatList
            data={displayActivities}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            removeClippedSubviews
            ListHeaderComponent={
              <View style={styles.listHeader}>
                {nudge}
                {travelerMode && (
                  <TravelerRow state={travelerRowState} showDistance={hasLocationAnchor} onPressActivity={setSelectedActivity} />
                )}
              </View>
            }
            // design-spec.md T8 (Tripadvisor initiative): a single caption
            // below the last card, present iff the visible list has >=1
            // Tripadvisor row — omitted otherwise (no reserved gap).
            ListFooterComponent={
              queryState.activities.some((activity) => Boolean(tripadvisorAttribution(activity))) ? (
                <Text style={styles.tripadvisorFooter}>
                  Restaurant, bar and café ratings, reviews and photos provided by Tripadvisor.
                </Text>
              ) : null
            }
          />
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {nudge}
            {travelerMode && (
              <TravelerRow state={travelerRowState} showDistance={hasLocationAnchor} onPressActivity={setSelectedActivity} />
            )}

            {queryState.status === 'loading' &&
              Array.from({ length: SKELETON_CARD_COUNT }).map((_, i) => <ActivityCardSkeleton key={i} />)}

            {queryState.status === 'loaded' && displayActivities.length === 0 && (
              <EmptyState hasFilters={hasFilters} onClearFilters={handleClearCategories} />
            )}

            {queryState.status === 'error' && <ErrorState message={queryState.message} onRetry={handleRetry} />}
          </ScrollView>
        )}

        {/* Keyed on open/closed so each open is a fresh mount — the sheet
            reads `appliedScopeDraft` as its initial draft once (same
            contract as FilterSheet/ScopeSheet's own remount-on-reopen
            comment). ponytail: committing `draft` here re-triggers the main
            query effect above, which re-runs the same request the sheet's
            own successful Apply tap JUST resolved — one accepted extra round
            trip per Apply. T2's onApply contract only hands back the draft,
            not the already-fetched result, and T2's own internals are out of
            this task's scope to change; upgrade path is widening that
            contract to `onApply(draft, result)` if the extra call ever
            matters (rate limits, latency). */}
        <ScopeSheet
          key={sheetVisible ? 'open' : 'closed'}
          visible={sheetVisible}
          initialDraft={appliedScopeDraft}
          onQuery={(draft) => queryActivities(buildFeedRequest(draft, appliedFilters.categories))}
          onApply={(draft) => setAppliedScopeDraft(draft)}
          onClose={closeSheet}
        />
      </SafeAreaView>

      {selectedActivity && (
        <View style={styles.detailOverlay}>
          <ActivityDetailScreen activity={selectedActivity} showDistance={hasLocationAnchor} onBack={closeDetail} />
        </View>
      )}
    </View>
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
  container: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  detailOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
  },
  header: {
    paddingVertical: space[4],
    paddingHorizontal: space[6],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: space[3],
  },
  listHeader: {
    gap: space[4],
    marginBottom: space[4],
  },
  list: {
    padding: space[4],
    gap: space[4],
    paddingBottom: space[6],
  },
  tripadvisorFooter: {
    fontSize: fontSize.xs,
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
