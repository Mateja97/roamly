import { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FilterChip } from '../../components/FilterChip';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { CATEGORY_OPTIONS } from '../activity-list/filters';
import type { Category } from '../activity-list/types';

type ActivityTypesScreenProps = {
  onConfirm: (categories: Category[]) => void;
  onBack: () => void;
};

// T2: sits between the scope picker and the activity list — narrows the
// search by category before the first query runs. Reuses CATEGORY_OPTIONS
// (no new taxonomy) and the Filter chip / select variant already shipped for
// the Filter sheet. Zero selected is a valid, non-blocking choice ("all
// types"), so there is no disabled/loading/error state on this screen — see
// design-spec.md's T2 section.
export function ActivityTypesScreen({ onConfirm, onBack }: ActivityTypesScreenProps) {
  const [selected, setSelected] = useState<Category[]>([]);
  const confirmFocus = useFocusable();

  // Same native-affordance back handling as ActivityListScreen (no router
  // yet — see App.tsx and APP_STANDARDS.md). iOS has no back path without a
  // navigator; accepted limitation, same as the list screen.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  function toggle(category: Category) {
    setSelected((prev) => (prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]));
  }

  const statusText = selected.length === 0 ? 'All activity types' : `${selected.length} types selected`;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.heading}>What are you into?</Text>
        <Text style={styles.subHint}>Pick a few types, or continue to see everything.</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.chipGrid}>
        {CATEGORY_OPTIONS.map((option) => (
          <FilterChip
            key={option.value}
            variant="select"
            label={option.label}
            selected={selected.includes(option.value)}
            onPress={() => toggle(option.value)}
          />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View accessible accessibilityLiveRegion="polite">
          <Text style={styles.statusLine}>{statusText}</Text>
        </View>
        <Pressable
          onPress={() => onConfirm(selected)}
          onFocus={confirmFocus.onFocus}
          onBlur={confirmFocus.onBlur}
          accessibilityRole="button"
          accessibilityLabel="Show activities"
          style={[styles.confirmButton, confirmFocus.focused && styles.confirmButtonFocused]}
        >
          <Text style={styles.confirmLabel}>Show activities</Text>
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
    paddingTop: space[8],
    paddingHorizontal: space[4],
  },
  heading: {
    fontSize: fontSize.xl,
    color: colors.primary,
    fontWeight: '700',
  },
  subHint: {
    marginTop: space[3],
    fontSize: fontSize.md,
    color: colors.textMuted,
  },
  scroll: {
    marginTop: space[8],
    flex: 1,
    paddingHorizontal: space[4],
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    paddingBottom: space[4],
  },
  footer: {
    paddingHorizontal: space[4],
    // ponytail: fixed extra bottom padding approximates home-indicator
    // clearance, same fixed-inset approach as FilterSheet's footer —
    // react-native-safe-area-context isn't a dependency yet.
    paddingBottom: space[6],
  },
  statusLine: {
    marginBottom: space[3],
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  confirmButton: {
    minHeight: 44,
    borderRadius: radius.default,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  confirmButtonFocused: {
    borderColor: colors.text,
  },
  confirmLabel: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.ink,
  },
});
