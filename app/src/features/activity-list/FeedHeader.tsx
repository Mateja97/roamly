import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CitySuggestion } from '../../api/cities';
import { Wordmark } from '../../components/Wordmark';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { contextLine, scopePillInfo } from './feedContext';
import type { Scope } from '../../types/scope';

type FeedHeaderProps = {
  scope: Scope;
  cities: CitySuggestion[];
  hour: number;
  travelerMode: boolean;
  onOpenScope: () => void;
};

// design-spec.md T3: "small Wordmark left; scope pill right" replacing the
// old icon+title row, plus a context line beneath it. T5 fix: the context
// line was on Marcellus at 20px, a third screen/size DESIGN_STANDARDS.md's
// Typography section never documented (it reserves Marcellus for the two
// screen-identity headers, never utility-bar/subtitle text) — system font
// stack now, matching the documented set instead of expanding it.
export function FeedHeader({ scope, cities, hour, travelerMode, onOpenScope }: FeedHeaderProps) {
  const pill = scopePillInfo(scope, cities);
  const Icon = pill.icon;
  const focus = useFocusable();

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <Wordmark width={110} />
        <Pressable
          onPress={onOpenScope}
          onFocus={focus.onFocus}
          onBlur={focus.onBlur}
          accessibilityRole="button"
          accessibilityLabel={`Scope: ${pill.label}. Opens the scope sheet.`}
          style={[styles.scopePill, focus.focused && styles.scopePillFocused]}
        >
          <Icon size={16} color={colors.primary} strokeWidth={1.75} />
          <Text style={styles.scopePillLabel} numberOfLines={1}>
            {pill.label}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.contextLine} numberOfLines={1}>
        {contextLine(scope, cities, hour, travelerMode)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space[2],
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scopePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    minHeight: 44,
    maxWidth: 220,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.cardHighlight,
    paddingHorizontal: space[3],
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  scopePillFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  scopePillLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
    flexShrink: 1,
  },
  contextLine: {
    fontSize: fontSize.lg,
    color: colors.text,
    lineHeight: fontSize.lg * 1.2,
  },
});
