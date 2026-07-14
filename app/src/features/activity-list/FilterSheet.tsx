import { useEffect, useRef, useState } from 'react';
import type { ElementRef, ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { X } from 'lucide-react-native';
import type { ActivitiesQueryResult } from '../../api/activities';
import { FilterChip } from '../../components/FilterChip';
import { Spinner } from '../../components/Spinner';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import {
  ANYWHERE_DISTANCE_STEP_KM,
  ANYWHERE_NO_LIMIT_SLIDER_VALUE,
  CATEGORY_OPTIONS,
  MAX_DISTANCE_KM,
  MIN_DISTANCE_KM,
  MIN_DISTANCE_KM_ANYWHERE,
  RATING_OPTIONS,
  defaultFilters,
} from './filters';
import type { Filters } from './types';
import type { Scope } from '../scope-picker/types';

type FilterSheetProps = {
  visible: boolean;
  initialFilters: Filters;
  scope: Scope;
  // Anywhere's distance slider is meaningless (and hidden) without a
  // device-location anchor — a value there-but-inert reads as a bug, not a
  // rule (Slider recipe's "Hidden" state). Always true for nearby.
  hasLocationAnchor: boolean;
  onApply: (filters: Filters) => Promise<ActivitiesQueryResult>;
  onClose: () => void;
};

// DESIGN_STANDARDS.md's Bottom sheet recipe: scrim + slide-up --surface
// panel with a gold top edge, focus trap, safe-area footer. Owns its own
// draft selection + apply-in-flight/error lifecycle — Apply only commits to
// the screen's applied filters (via onApply) on success; on failure the
// sheet stays open with the user's selection intact (see ActivityListScreen).
export function FilterSheet({ visible, initialFilters, scope, hasLocationAnchor, onApply, onClose }: FilterSheetProps) {
  const [draft, setDraft] = useState<Filters>(initialFilters);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<ElementRef<typeof Pressable>>(null);
  const [translateY] = useState(() => new Animated.Value(OFFSCREEN_Y));
  const [scrimOpacity] = useState(() => new Animated.Value(0));

  // `draft`/`error` are seeded straight from props above (via useState's
  // initializer) rather than reset by an effect — the caller remounts this
  // component (keyed on open/closed, see ActivityListScreen) every time it
  // opens, so a fresh mount already means a fresh draft. This effect only
  // has to run the open-only side effects: moving focus in, and animating.
  useEffect(() => {
    if (!visible) return;
    // Move focus into the panel on open (web/RNW keyboard path — native
    // iOS/Android modal presentation handles this itself via the OS).
    closeRef.current?.focus?.();

    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled) return;
      if (reduceMotion) {
        translateY.setValue(0);
        scrimOpacity.setValue(1);
        return;
      }
      // ponytail: fixed OFFSCREEN_Y approximation instead of measuring the
      // real panel height via onLayout — close enough for an entrance
      // slide, not worth the extra render-cycle bookkeeping for a
      // decorative motion.
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

  async function handleApply() {
    setApplying(true);
    setError(null);
    const result = await onApply(draft);
    setApplying(false);
    if (result.status === 'success') {
      onClose();
    } else {
      setError(result.message);
    }
  }

  function handleClearAll() {
    setDraft(defaultFilters(scope));
    setError(null);
  }

  const closeFocus = useFocusable();
  const applyFocus = useFocusable();
  const clearFocus = useFocusable();

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]}>
          <Pressable
            style={ABSOLUTE_FILL}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close filters"
          />
        </Animated.View>

        <Animated.View style={[styles.panel, { transform: [{ translateY }] }]} accessibilityViewIsModal>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Filters</Text>
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

          <ScrollView contentContainerStyle={styles.scroll}>
            <FilterGroup label="Category">
              {CATEGORY_OPTIONS.map((option) => (
                <FilterChip
                  key={option.value}
                  variant="select"
                  label={option.label}
                  selected={draft.categories.includes(option.value)}
                  onPress={() =>
                    setDraft((prev) => ({
                      ...prev,
                      categories: prev.categories.includes(option.value)
                        ? prev.categories.filter((c) => c !== option.value)
                        : [...prev.categories, option.value],
                    }))
                  }
                />
              ))}
            </FilterGroup>

            <FilterGroup label="Minimum rating">
              {singleSelectChips(RATING_OPTIONS, draft.minRating, (minRating) =>
                setDraft((prev) => ({ ...prev, minRating }))
              )}
            </FilterGroup>

            {(scope === 'nearby' || hasLocationAnchor) && (
              <DistanceSlider
                scope={scope}
                value={draft.maxDistanceKm}
                onChange={(maxDistanceKm) => setDraft((prev) => ({ ...prev, maxDistanceKm }))}
              />
            )}
          </ScrollView>

          {/* Sibling of the ScrollView, not inside it — design-spec.md calls
              for the Apply error to surface "above the footer (reserved
              space)", i.e. always visible, not scrollable out of view with
              the filter groups on a long list. */}
          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.footer}>
            <Pressable
              onPress={handleApply}
              onFocus={applyFocus.onFocus}
              onBlur={applyFocus.onBlur}
              disabled={applying}
              accessibilityRole="button"
              accessibilityLabel={applying ? 'Applying filters' : 'Apply filters'}
              style={[styles.applyButton, applyFocus.focused && styles.applyButtonFocused]}
            >
              {applying && <Spinner />}
              <Text style={styles.applyLabel}>{applying ? 'Applying…' : 'Apply filters'}</Text>
            </Pressable>
            <Pressable
              onPress={handleClearAll}
              onFocus={clearFocus.onFocus}
              onBlur={clearFocus.onBlur}
              accessibilityRole="button"
              accessibilityLabel="Clear all"
              style={[styles.clearButton, clearFocus.focused && styles.clearButtonFocused]}
            >
              <Text style={styles.clearLabel}>Clear all</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.chipsRow}>{children}</View>
    </View>
  );
}

// Rating is a plain single-select-with-an-"Any"-option group (unlike price
// tier, which has no "Any" chip and toggles off instead).
function singleSelectChips<T>(
  options: { value: T | null; label: string }[],
  selected: T | null,
  onSelect: (value: T | null) => void
) {
  return options.map((option) => (
    <FilterChip key={option.label} variant="select" label={option.label} selected={selected === option.value} onPress={() => onSelect(option.value)} />
  ));
}

// @react-native-community/slider's published typings don't expose a
// `thumbStyle`/`thumbSize` override that actually reaches its web renderer —
// 20 is that renderer's own fixed thumb size (`constants.THUMB_SIZE`), used
// here only to position the decorative ring, not to resize the real thumb.
const THUMB_SIZE = 20;
const RING_SIZE = THUMB_SIZE + 8; // ~2px --surface gap on each side, per the recipe

// DESIGN_STANDARDS.md's Slider (range) recipe: continuous distance control
// replacing the old fixed distance chips. Delegates drag/keyboard/a11y to
// @react-native-community/slider (native thumb + track) and layers the
// label row, end labels, and the decorative drag/focus ring on top — the
// ring position is a percentage-of-track approximation (see trackWidth),
// not a pixel-exact readout of the native thumb.
//
// Scope-aware: Nearby keeps the unchanged 1-50km range. Anywhere's range is
// wider (100-2000km) with one extra top stop past the numeric ceiling that
// means "no limit" — modeled as a slider-only sentinel value
// (ANYWHERE_NO_LIMIT_SLIDER_VALUE) that maps to Filters.maxDistanceKm = null.
function DistanceSlider({
  scope,
  value,
  onChange,
}: {
  scope: Scope;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const isAnywhere = scope === 'anywhere';
  const min = isAnywhere ? MIN_DISTANCE_KM_ANYWHERE : MIN_DISTANCE_KM;
  const max = isAnywhere ? ANYWHERE_NO_LIMIT_SLIDER_VALUE : MAX_DISTANCE_KM;
  const step = isAnywhere ? ANYWHERE_DISTANCE_STEP_KM : 1;
  const sliderValue = value ?? (isAnywhere ? ANYWHERE_NO_LIMIT_SLIDER_VALUE : MAX_DISTANCE_KM);
  const isNoLimit = isAnywhere && sliderValue >= ANYWHERE_NO_LIMIT_SLIDER_VALUE;

  const [dragging, setDragging] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const focus = useFocusable();
  const showRing = (dragging || focus.focused) && trackWidth > 0;
  const fraction = (sliderValue - min) / (max - min);
  const thumbCenter = THUMB_SIZE / 2 + fraction * (trackWidth - THUMB_SIZE);

  function handleValueChange(next: number) {
    onChange(isAnywhere && next >= ANYWHERE_NO_LIMIT_SLIDER_VALUE ? null : next);
  }

  return (
    <View style={styles.group}>
      <View style={styles.distanceLabelRow}>
        <Text style={styles.groupLabel}>Max distance</Text>
        <Text style={styles.distanceValue}>{isNoLimit ? 'No limit' : `Within ${sliderValue} km`}</Text>
      </View>
      <View onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}>
        <Slider
          style={styles.slider}
          minimumValue={min}
          maximumValue={max}
          step={step}
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
        {showRing && (
          <View pointerEvents="none" style={[styles.sliderRing, { left: thumbCenter - RING_SIZE / 2 }]} />
        )}
      </View>
      <View style={styles.distanceEndLabelsRow}>
        <Text style={styles.distanceEndLabel}>{min} km</Text>
        <Text style={styles.distanceEndLabel}>{isAnywhere ? 'No limit' : `${MAX_DISTANCE_KM} km`}</Text>
      </View>
    </View>
  );
}

const OFFSCREEN_Y = 600;

// RN's own `StyleSheet.absoluteFillObject` isn't typed in this RN version's
// generated `.d.ts` (it exists at runtime) — a plain literal is the smaller
// fix than fighting the type gap.
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
  group: {
    gap: space[3],
  },
  groupLabel: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  distanceLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  // Drag/focus feedback ring — offset ~2px from the thumb (never flush; cream
  // directly on the gold thumb is only 2.32:1, an accepted gap per
  // design-spec.md, not something to "fix" by moving the ring onto the thumb).
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
  distanceEndLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  distanceEndLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  errorBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.default,
    padding: space[3],
    marginTop: space[3],
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.error,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    // ponytail: fixed extra bottom padding approximates home-indicator
    // clearance — react-native-safe-area-context isn't a dependency yet, and
    // RN's own SafeAreaView insets from the device's physical edges (wrong
    // for a bottom-anchored panel that doesn't reach the top). Add real
    // inset-aware padding if a second bottom sheet needs the same thing.
    paddingVertical: space[4],
    paddingBottom: space[6],
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
  applyLabel: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.ink,
  },
  clearButton: {
    minHeight: 44,
    borderRadius: radius.default,
    paddingHorizontal: space[4],
    alignItems: 'center',
    justifyContent: 'center',
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  clearButtonFocused: {
    backgroundColor: colors.surfaceHover,
  },
  clearLabel: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.textMuted,
  },
});
