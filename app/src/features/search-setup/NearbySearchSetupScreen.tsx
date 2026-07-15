import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, MapPin, X } from 'lucide-react-native';
import type { ActivitiesQueryRequest } from '../../api/activities';
import { queryActivities } from '../../api/activities';
import { FilterChip } from '../../components/FilterChip';
import { Spinner } from '../../components/Spinner';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontFamily, fontSize, radius, space } from '../../theme/tokens';
import { CATEGORY_OPTIONS, NEARBY_RADIUS_KM } from '../activity-list/filters';
import type { Category } from '../activity-list/types';
import type { ScopeSelection } from '../scope-picker/types';

type NearbySearchSetupScreenProps = {
  selection: ScopeSelection;
  onConfirm: (categories: Category[]) => void;
  onBack: () => void;
};

// design-spec.md's T6 section: replaces ActivityTypesScreen for the Nearby
// flow only (Anywhere keeps its own screen until T5 lands, see App.tsx). No
// distance is adjustable here — the fixed-range card is a static summary,
// not a control — so unlike FilterSheet's DistanceSlider there is no
// max_distance_km in the request at all: T2 already fixes/ignores it
// server-side for `nearby`, so omitting it is simpler than sending a value
// the backend throws away.
function buildRequest(selection: ScopeSelection, categories: Category[]): ActivitiesQueryRequest {
  const request: ActivitiesQueryRequest = { scope: 'nearby' };
  if (selection.coordinates) {
    request.current_location = { lat: selection.coordinates.latitude, lng: selection.coordinates.longitude };
  }
  if (categories.length > 0) request.categories = categories;
  return request;
}

export function NearbySearchSetupScreen({ selection, onConfirm, onBack }: NearbySearchSetupScreenProps) {
  const [selected, setSelected] = useState<Category[]>([]);
  // Last-known result count, kept visible while a new one resolves (design
  // spec's "live count" rule) — never reset to null/blank on a re-fetch.
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const backFocus = useFocusable();
  const resetFocus = useFocusable();
  const ctaFocus = useFocusable();
  const dismissFocus = useFocusable();

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

  const runQuery = useCallback(
    (categories: Category[]) => queryActivities(buildRequest(selection, categories)),
    [selection]
  );

  // Live count: re-derives "Show {count} activities" as chips toggle. Runs
  // on mount too (selected starts as []), so the default state already
  // shows the all-categories count once it resolves.
  useEffect(() => {
    let cancelled = false;
    runQuery(selected).then((result) => {
      if (cancelled) return;
      if (result.status === 'success') {
        setCount(result.activities.length);
        setError(null);
      } else {
        setError(result.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selected, runQuery]);

  function toggle(category: Category) {
    setSelected((prev) => (prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]));
  }

  // The button's own press-time query, distinct from the live-count effect
  // above: catches a transient failure before navigating (design-spec's CTA
  // loading/error states), rather than trusting a possibly-stale count.
  async function handleShow() {
    setSubmitting(true);
    setError(null);
    const result = await runQuery(selected);
    setSubmitting(false);
    if (result.status === 'success') {
      setCount(result.activities.length);
      onConfirm(selected);
    } else {
      setError(result.message);
    }
  }

  // ponytail: null (not-yet-loaded) reads as 0/disabled rather than adding a
  // distinct initial-loading state — the live-count effect resolves almost
  // immediately after mount and the design spec never blanks/spins for a
  // count, so there is nothing better to show meanwhile.
  const shownCount = count ?? 0;
  const ctaDisabled = submitting || shownCount === 0;

  return (
    <SafeAreaView style={styles.screen}>
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
        <View style={styles.scopePill} accessible accessibilityLabel="Scope: Nearby">
          <MapPin size={16} color={colors.primary} strokeWidth={1.75} />
          <Text style={styles.scopePillLabel}>NEARBY</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Refine your search</Text>
          <Text style={styles.subtitle}>Choose what you&apos;re into, right around you.</Text>
        </View>

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

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>Activities</Text>
            <Text style={styles.selectedCount}>{selected.length} selected</Text>
          </View>
          <View style={styles.chipGrid}>
            {CATEGORY_OPTIONS.map((option) => (
              <FilterChip
                key={option.value}
                variant="select"
                label={option.label}
                selected={selected.includes(option.value)}
                onPress={() => toggle(option.value)}
              />
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={styles.errorRegion}>
        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              onPress={() => setError(null)}
              onFocus={dismissFocus.onFocus}
              onBlur={dismissFocus.onBlur}
              accessibilityRole="button"
              accessibilityLabel="Dismiss error"
              style={[styles.dismissButton, dismissFocus.focused && styles.dismissButtonFocused]}
            >
              <X size={16} color={colors.error} strokeWidth={1.75} />
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Pressable
          onPress={() => setSelected([])}
          onFocus={resetFocus.onFocus}
          onBlur={resetFocus.onBlur}
          disabled={selected.length === 0}
          accessibilityRole="button"
          accessibilityLabel="Reset"
          accessibilityState={{ disabled: selected.length === 0 }}
          style={[styles.resetButton, resetFocus.focused && styles.resetButtonFocused]}
        >
          <Text style={[styles.resetLabel, selected.length === 0 && styles.resetLabelDisabled]}>Reset</Text>
        </Pressable>
        <Pressable
          onPress={handleShow}
          onFocus={ctaFocus.onFocus}
          onBlur={ctaFocus.onBlur}
          disabled={ctaDisabled}
          accessibilityRole="button"
          accessibilityLabel={submitting ? 'Searching' : `Show ${shownCount} activities`}
          accessibilityState={{ disabled: ctaDisabled }}
          style={[styles.ctaButton, ctaFocus.focused && styles.ctaButtonFocused, ctaDisabled && !submitting && styles.ctaButtonDisabled]}
        >
          {submitting && !reduceMotion && <Spinner />}
          <Text style={[styles.ctaLabel, ctaDisabled && !submitting && styles.ctaLabelDisabled]}>
            {submitting ? 'Searching…' : `Show ${shownCount} activities`}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
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
    minWidth: 44,
    paddingHorizontal: space[2],
    borderRadius: radius.default,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  backButtonFocused: {
    backgroundColor: colors.surfaceHover,
  },
  backLabel: {
    fontSize: fontSize.md,
    color: colors.textMuted,
  },
  scopePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: space[1],
    paddingHorizontal: space[3],
  },
  scopePillLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 0.6,
    color: colors.text,
  },
  scroll: {
    paddingHorizontal: space[6],
    paddingBottom: space[6],
  },
  titleBlock: {
    marginTop: space[6],
  },
  title: {
    fontFamily: fontFamily.display,
    fontSize: fontSize.xl,
    color: colors.text,
    fontWeight: '400',
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
  sectionHeaderRow: {
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
  selectedCount: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  rangeCard: {
    marginTop: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: colors.surface,
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
  chipGrid: {
    marginTop: space[3],
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  errorRegion: {
    paddingHorizontal: space[6],
    // ponytail: minHeight: 1 (not a true reserved height) — same accepted
    // approximation as ScopePickerScreen's messageRegion; a fixed-height
    // reservation would need to match the banner's wrapped text height,
    // which varies with the server message.
    minHeight: 1,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
    marginBottom: space[3],
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
    borderRadius: radius.default,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  dismissButtonFocused: {
    backgroundColor: colors.surfaceHover,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[6],
    paddingTop: space[4],
    // ponytail: fixed extra bottom padding approximates home-indicator
    // clearance, same accepted approach as FilterSheet/ActivityTypesScreen's
    // footers — react-native-safe-area-context isn't threaded per-edge here.
    paddingBottom: space[6],
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
    fontWeight: '500',
    color: colors.textMuted,
  },
  resetLabelDisabled: {
    color: colors.textDisabled,
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
  ctaLabelDisabled: {
    color: colors.textDisabled,
  },
});
