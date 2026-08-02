import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, space } from '../../theme/tokens';
import { classifyField } from './fieldKind';

type ProseBlockProps = {
  heading: string;
  value: string | undefined;
};

const CLAMP_LINES = 3;
const LINE_HEIGHT = fontSize.md * 1.5;

// design-spec.md's "Prose block" slot (§B5): the one legal home for a
// generated sentence — replaces the inline `<Text>` description render in
// ActivityDetailScreen.tsx. `prose` has no length-based rejection in
// `classifyField` (only the absence rule); over-length text clamps to 3
// lines with a "Show more" control here instead of being omitted. An absent
// value omits the heading too (slot-level state rule).
export function ProseBlock({ heading, value }: ProseBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [clampable, setClampable] = useState(false);
  const text = classifyField('prose', value);
  if (!text) return null;

  return (
    <View style={styles.block}>
      <Text style={styles.heading}>{heading}</Text>
      <View>
        <Text
          testID="prose-block-body"
          style={styles.body}
          numberOfLines={expanded ? undefined : CLAMP_LINES}
        >
          {text}
        </Text>
        {!expanded && !clampable && (
          // ponytail: `numberOfLines` alone has no "did this actually
          // overflow" signal — RN's `onTextLayout` would report it, but
          // react-native-web (the platform this gate can actually verify)
          // never implements `onTextLayout` (grepped its Text export: no
          // hits), so the app-wide "Show more" control would silently never
          // appear on web. `onLayout` (universally supported, already used
          // elsewhere in this app) on an invisible unclamped duplicate is
          // the cross-platform-safe measurement: its rendered height only
          // exceeds the fixed `CLAMP_LINES * LINE_HEIGHT` box when the real
          // text genuinely needed a 4th+ line.
          <Text
            testID="prose-block-measure"
            style={[styles.body, styles.measure]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onLayout={(e) => {
              if (e.nativeEvent.layout.height > CLAMP_LINES * LINE_HEIGHT + 1) setClampable(true);
            }}
          >
            {text}
          </Text>
        )}
      </View>
      {clampable && !expanded && (
        <Pressable onPress={() => setExpanded(true)} accessibilityRole="button">
          <Text style={styles.showMore}>Show more</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: space[2],
  },
  heading: {
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: fontSize.xs * 0.05,
    color: colors.textMuted,
    fontWeight: '600',
  },
  body: {
    fontSize: fontSize.md,
    color: colors.text,
    lineHeight: LINE_HEIGHT,
  },
  measure: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    opacity: 0,
  },
  showMore: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.primary,
  },
});
