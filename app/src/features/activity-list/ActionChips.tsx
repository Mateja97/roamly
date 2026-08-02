import type { ComponentType } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { ExternalLink, Menu, Navigation, Phone, Share2 } from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';

export type ActionChipKind = 'directions' | 'website' | 'call' | 'share' | 'menu';
export type ActionChipItem = { kind: ActionChipKind; onPress: () => void };

const MAX_CHIPS = 4;

const ICON: Record<ActionChipKind, ComponentType<LucideProps>> = {
  directions: Navigation,
  website: ExternalLink,
  call: Phone,
  share: Share2,
  menu: Menu,
};

const LABEL: Record<ActionChipKind, string> = {
  directions: 'Directions',
  website: 'Website',
  call: 'Call',
  share: 'Share',
  menu: 'Menu',
};

type ActionChipsProps = { items: ActionChipItem[] };

// design-spec.md's "Action chips" slot (§B2): ≤4 compact secondary actions,
// icon + label, horizontally scrollable on overflow — the gold-structure/
// cream-label rule DESIGN_STANDARDS.md documents for the Scope indicator
// pill (transparent fill, 1px `--primary` hairline, `--text` cream label).
// Drawn from a fixed set (Directions/Website/Call/Share/Menu); the caller
// decides which are present for a given venue — this component only caps at
// 4 and renders nothing below 1.
export function ActionChips({ items }: ActionChipsProps) {
  const chips = items.slice(0, MAX_CHIPS);
  if (chips.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {chips.map((item) => (
        <ActionChip key={item.kind} item={item} />
      ))}
    </ScrollView>
  );
}

function ActionChip({ item }: { item: ActionChipItem }) {
  const focus = useFocusable();
  const Icon = ICON[item.kind];
  return (
    <Pressable
      onPress={item.onPress}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      accessibilityRole="button"
      accessibilityLabel={LABEL[item.kind]}
      style={({ pressed }) => [
        styles.chip,
        pressed && styles.chipPressed,
        focus.focused && styles.chipFocused,
      ]}
    >
      <Icon size={15} color={colors.primary} strokeWidth={1.75} />
      <Text style={styles.label}>{LABEL[item.kind]}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space[2],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: space[1],
    paddingHorizontal: space[3],
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  chipPressed: {
    backgroundColor: colors.surfaceHover,
  },
  chipFocused: {
    borderWidth: 2,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
  },
});
