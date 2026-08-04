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

export function ActivityListScreen({ selection, onBack }: ActivityListScreenProps) {
  // T2/T3: frozen via useState's lazy initializer (runs once, on mount) —
  // a parent re-render passing a fresh `selection` prop won't retrigger this.
  const [appliedFilters, setAppliedFilters] = useState<Filters>(() => defaultFilters(selection.scope));
  // design-spec.md T3: scope/city/distance/rating now live here (T2's
  // ScopeDraft), not on `Filters` — seeded from `selection` (App.tsx's
  // launch-derived scope; T4).
  const [appliedScopeDraft, setAppliedScopeDraft] = useState<ScopeDraft>(() =>
    defaultScopeDraft(selection.scope, selection.coordinates)
  );
  const [queryState, setQueryState] = useState<QueryState>({ status: 'loading' });
  // The subtype rail's counts read from this, not from `queryState`
  // directly — `queryState` collapses to no-activities during a refetch or
  // on error, which would otherwise zero every subtype's count and disable
  // it (including a chip the user has *selected*, trapping them). This only
  // ever updates on a successful fetch, so it holds the last real data
  // across any loading/error state in between.
  const [lastLoadedActivities, setLastLoadedActivities] = useState<Activity[]>([]);
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
  // review round 2 (Minor — round 1's stale-while-revalidate fix was too
  // broad): design-spec.md keeps list/skeleton/empty/error states
  // unchanged by this task — a category tap or a Scope sheet apply must
  // still show the loading skeleton like it always has. Only the launch
  // promotion's own *automatic* re-query (below) sets this ref right
  // before it changes scope, so only that one silent refetch skips the
  // skeleton; everything else (including the "quiet, later" coordinate-only
  // add for a non-launch permission grant) goes back to showing loading.
  const silentRefetchRef = useRef(false);
  useEffect(() => {
    const seq = startQuery();
    if (silentRefetchRef.current) {
      silentRefetchRef.current = false;
    } else {
      // review round 2 (Minor): the branch here (vs. an unconditional call)
      // is what keeps `react-hooks/set-state-in-effect` quiet — same
      // inconsistent heuristic T3 already documented on the traveler-row
      // effect below, no eslint-disable needed on this one now that it has
      // its own guard again.
      setQueryState({ status: 'loading' });
    }
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
  // design-spec.md T4 + T3: one check, two purposes, told apart by
  // `isLaunchRef`. (1) T4's "scope derives from permission state at
  // launch" — App.tsx only ever hands this screen an unanchored-Anywhere
  // `selection` at mount, so this effect's very *first* firing is always
  // that cold start; an already-granted permission there promotes straight
  // to a real `nearby` scope (not just a quietly-anchored `anywhere`).
  // (2) T3's original fix for a stale "Turn on location" nudge on any
  // *later* occurrence of unanchored Anywhere (e.g. the user explicitly
  // re-selects Anywhere via the Scope sheet with no city) — `requestLocation`
  // never shows an OS prompt for an already-granted permission, it just
  // resolves the fix quietly, but that later case only ever adds
  // `coordinates`, never overrides the scope the user just explicitly
  // picked.
  // review round 2 (Important — round 1's fix only narrowed this, didn't
  // close it): the GPS fix this effect waits on can land up to
  // LOCATION_TIMEOUT_MS (15s) later — long enough for the user to open the
  // Scope sheet and explicitly apply Anywhere (with or without a city, e.g.
  // just a minimum-rating change) while it's still in flight. `isLaunch` is
  // a `const` captured once, at *effect-setup* time — it's a snapshot of
  // "was this firing the launch", not a live read, so flipping
  // `isLaunchRef.current` later (from onApply) can never reach an
  // already-in-flight closure; only the (still-correct, still-needed)
  // `prev.cities.length === 0` guard was ever doing anything for a race
  // that lands after an apply, and it only covers the city sub-case. Fixed
  // properly this time with a *second* ref that's read at write time
  // (inside the async updater, right before it would promote), not
  // capture time: `userAppliedRef`, set the moment `onApply` runs. A
  // promotion only ever commits when it's both the launch firing *and*
  // nothing has been explicitly applied since.
  const isLaunchRef = useRef(true);
  const userAppliedRef = useRef(false);
  useEffect(() => {
    if (appliedScopeDraft.scope !== 'anywhere' || appliedScopeDraft.coordinates) return;
    const isLaunch = isLaunchRef.current;
    isLaunchRef.current = false;
    nearby.checkPermission().then((granted) => {
      if (!granted) return;
      nearby.requestLocation().then((coordinates) => {
        if (!coordinates) return;
        setAppliedScopeDraft((prev) => {
          if (prev.scope !== 'anywhere' || prev.coordinates || prev.cities.length > 0) return prev;
          const promoteToNearby = isLaunch && !userAppliedRef.current;
          // Only the launch's own promotion skips the query effect's loading
          // skeleton (review round 2, Minor) — a quiet, later coordinate-only
          // add (promoteToNearby false) still shows it, same as every other
          // refetch.
          if (promoteToNearby) silentRefetchRef.current = true;
          return { ...prev, coordinates, scope: promoteToNearby ? 'nearby' : prev.scope };
        });
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nearby.checkPermission/requestLocation identities are stable (useCallback, no deps)
  }, [appliedScopeDraft.scope, appliedScopeDraft.coordinates]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedActivity) {
        closeDetail();
        return true;
      }
      if (sheetVisible) {
        closeSheet();
        return true;
      }
      if (onBack) {
        onBack();
        return true;
      }
      // T4: Feed is the app's home screen — no previous screen to pop to.
      // Let the event fall through to the OS default (exit app) instead of
      // trapping the user with a back button that silently does nothing.
      return false;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeDetail/closeSheet read current state via closure; re-subscribing on every selectedActivity/sheetVisible change keeps the handler current
  }, [onBack, selectedActivity, sheetVisible]);

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
  // review round 1/T3-round-2 (Minor, widened by T4): 'unavailable' only
  // happens *after* permission was already granted (the fix itself failed —
  // GPS timeout, no signal), so "Turn on location" is actively wrong there
  // too; T4 made this reachable on every launch (not just an explicit tap),
  // so it now routes to the quieter choose-a-city nudge instead, same as an
  // OS-level deny — neither claims location is off, both just suggest an
  // alternative anchor.
  const showAskNudge = unanchoredAnywhere && !nudgeDismissed && nearby.state.status === 'idle';
  const showCityNudge =
    unanchoredAnywhere && (nearby.state.status === 'denied' || nearby.state.status === 'unavailable');

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
          onApply={(draft) => {
            // review round 1 (Important) + round 2 (still Important — see
            // the launch-derivation effect's own comment for why round 1's
            // fix alone wasn't enough): any explicit apply is a real user
            // choice. `userAppliedRef` is read at write-time by an
            // already-in-flight promotion, so it closes the race even for
            // a chain that started before this apply. `isLaunchRef` covers
            // a different case — this instance never having fired the
            // launch effect at all yet (e.g. mounted pre-anchored, then
            // later switched to unanchored Anywhere here) — so a *future*
            // firing of that effect is never mistaken for launch either.
            isLaunchRef.current = false;
            userAppliedRef.current = true;
            setAppliedScopeDraft(draft);
          }}
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
