import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { PhotoAttribution } from '../api/activities';
import { useFocusable } from '../hooks/useFocusable';
import { colors, fontSize, space } from '../theme/tokens';

type PhotoAttributionCaptionProps = {
  attribution: PhotoAttribution | undefined;
  /** Horizontal inset matched to the photo's own horizontal padding (card body vs. detail content column). */
  horizontalInset: number;
};

// DESIGN_STANDARDS.md's Photo attribution recipe: a caption flush below the
// photo it credits, with a --border top hairline as the "Google-sourced"
// visual distinction. Renders nothing when attribution is absent, so
// placeholder photos with no attribution data are unaffected.
export function PhotoAttributionCaption({ attribution, horizontalInset }: PhotoAttributionCaptionProps) {
  const focus = useFocusable();
  if (!attribution) return null;

  const caption = (
    <Text style={styles.prefix}>
      Photo by <Text style={attribution.link ? styles.link : styles.prefix}>{attribution.author}</Text>
    </Text>
  );

  const link = attribution.link;
  if (!link) {
    return <View style={[styles.strip, { paddingHorizontal: horizontalInset }]}>{caption}</View>;
  }

  return (
    <Pressable
      onPress={() => {
        Linking.openURL(link).catch(() => {
          // ponytail: design spec waives error UI for a dead attribution link — silence the rejection.
        });
      }}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      accessibilityRole="link"
      accessibilityLabel={`Photo by ${attribution.author}`}
      style={[
        styles.strip,
        styles.stripWithLink,
        { paddingHorizontal: horizontalInset },
        focus.focused && styles.stripFocused,
      ]}
    >
      {caption}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: space[2],
  },
  stripWithLink: {
    minHeight: 44,
    justifyContent: 'center',
  },
  stripFocused: {
    // Overrides strip's borderTop* explicitly too — RN's border-side resolution
    // prefers the more specific borderTopWidth/borderTopColor over borderWidth/
    // borderColor regardless of style-array order, so all 4 sides must be named here.
    borderWidth: 2,
    borderColor: colors.primary,
    borderTopWidth: 2,
    borderTopColor: colors.primary,
  },
  prefix: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  link: {
    fontSize: fontSize.xs,
    color: colors.text,
    textDecorationLine: 'underline',
  },
});
