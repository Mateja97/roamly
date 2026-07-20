import { useEffect, useRef, useState } from 'react';
import type { ElementRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { capitalize, type WeekHoursModalData } from './activityDetailConfig';

type WeekHoursModalProps = { data: WeekHoursModalData; onClose: () => void };

const OFFSCREEN_Y = 500;
const ABSOLUTE_FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

// opening-hours T2: reuses PhotoViewerModal's conditional-mount pattern
// (the caller renders `{modalOpen && <WeekHoursModal .../>}`, so mount itself
// is the open transition, no `visible` prop to toggle) plus DESIGN_STANDARDS.md's
// Bottom sheet chrome/motion/focus-trap recipe already built in FilterSheet.tsx
// (scrim + slide-up --surface panel, gold top edge, drag handle, Ghost close).
// Lists T1's own `weekView` output Monday->Sunday — no reimplementation of the
// closed/split/always-open formatting.
export function WeekHoursModal({ data, onClose }: WeekHoursModalProps) {
  const insets = useSafeAreaInsets();
  const closeRef = useRef<ElementRef<typeof Pressable>>(null);
  const [translateY] = useState(() => new Animated.Value(OFFSCREEN_Y));
  const [scrimOpacity] = useState(() => new Animated.Value(0));
  const closeFocus = useFocusable();

  // Mount-only open animation (mirrors FilterSheet's `visible`-keyed effect —
  // here mounting the component *is* opening it, so no visibility toggle to
  // key off). ponytail: near-duplicate of FilterSheet's own open effect —
  // accepted rather than extracting a shared hook for 2 call sites; pull one
  // out if a third bottom-sheet-style modal shows up.
  useEffect(() => {
    closeRef.current?.focus?.();
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled) return;
      if (reduceMotion) {
        translateY.setValue(0);
        scrimOpacity.setValue(1);
        return;
      }
      Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(scrimOpacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]).start();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]}>
          <Pressable
            style={ABSOLUTE_FILL}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close opening hours"
          />
        </Animated.View>

        <Animated.View style={[styles.panel, { transform: [{ translateY }] }]} accessibilityViewIsModal>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Opening hours</Text>
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

          <View style={[styles.list, { paddingBottom: space[6] + insets.bottom }]}>
            {data.days.map((row) => {
              const isToday = row.day === data.today;
              return (
                <View
                  key={row.day}
                  style={[styles.dayRow, isToday && styles.dayRowToday]}
                >
                  <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>
                    {capitalize(row.day)}
                    {isToday ? ' · Today' : ''}
                  </Text>
                  <Text style={styles.hoursLabel}>{row.hours}</Text>
                </View>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

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
  list: {
    paddingTop: space[2],
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingVertical: space[2],
    paddingHorizontal: space[2],
    borderRadius: radius.default,
  },
  dayRowToday: {
    backgroundColor: colors.surfaceHover,
  },
  dayLabel: {
    fontSize: fontSize.md,
    color: colors.textMuted,
  },
  dayLabelToday: {
    color: colors.primary,
    fontWeight: '600',
  },
  hoursLabel: {
    fontSize: fontSize.md,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
});
