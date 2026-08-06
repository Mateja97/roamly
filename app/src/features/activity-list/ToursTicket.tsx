import { useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Line, Path } from 'react-native-svg';
import { ArrowRight, Compass, ExternalLink } from 'lucide-react-native';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { toursDeepLink } from './toursPartner';

const STUB_HEIGHT = 104;
const NOTCH_SIZE = 16;
const GO_BUTTON_SIZE = 38;
const COMPASS_WELL = 52;

// The issuer stamp's mark (design-spec section B). GetYourGuide's own
// brand-kit asset, once the partner portal supplies it — `require()` it here
// and the plate renders itself. Deliberately null until then: their mark may
// not be redrawn or recolored (Partner TCs 4.3.1 iv), and copies from logo
// aggregators or app screenshots are not their brand kit. The ticket is
// designed to look finished without it — the written attribution below
// already carries the meaning, so the plate is simply omitted (no reserved
// gap, no fallback text).
// ponytail: a null constant, not a config flag — there is exactly one asset
// and it either exists or it doesn't.
const PARTNER_MARK: number | null = null;

// The Tours & Experiences entry point, built on the Activity card's
// torn-ticket anatomy (DESIGN_STANDARDS.md) with the photo well replaced by a
// 104px stub: partner imagery may not be stored (Partner TCs 4.2.2 iii), and
// a stock photo would imply a specific tour Roamly isn't selling.
//
// Carries **no** GetYourGuide content — every word is Roamly's — which is what
// lets it sit in the feed at all (4.2.2 v forbids intermixing their content
// with other sources; a link that quotes nothing isn't their content). What it
// does carry is the partner's identity: the issuer stamp above, the written
// attribution, and the commission disclosure that 3.2.2 and consumer law
// require of an affiliate link.
//
// Phase 1 hands off to the system browser rather than embedding GYG's widget:
// booking and payment happen on their real origin with its own URL bar, and
// the app takes no new dependency to do it (`Linking` is React Native core).
export function ToursTicket({ city }: { city: string | null }) {
  const focus = useFocusable();
  const [failed, setFailed] = useState(false);

  const title = city ? `Book a guided tour in ${city}` : 'Book a guided tour';

  function handlePress() {
    setFailed(false);
    // Rejects only when no handler can open an https URL (effectively no
    // browser present). Rare, but an unhandled branch is a bug per
    // APP_STANDARDS.md — surface it on the card instead of failing silently.
    Linking.openURL(toursDeepLink(city)).catch(() => setFailed(true));
  }

  return (
    <Pressable
      onPress={handlePress}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      accessibilityRole="button"
      accessibilityLabel={`${title}. Opens GetYourGuide in your browser.`}
      style={[styles.card, focus.focused && styles.cardFocused]}
    >
      {({ pressed }) => (
        <>
          <View style={styles.stub} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {/* Two flight-path curves, the Welcome screen's motif at stub
                scale. FlightPathBackground itself is a full-screen 402x874
                composition — wrong viewBox for a 104px well, so these are
                drawn here rather than bent into a shared component. */}
            <Svg width="100%" height={STUB_HEIGHT} viewBox="0 0 362 104" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
              <Path
                d="M-10 74 C 90 30, 250 96, 380 34"
                stroke={colors.primary}
                strokeWidth={2.5}
                strokeDasharray="2 12"
                strokeLinecap="round"
                strokeOpacity={0.3}
                fill="none"
              />
              <Path
                d="M-10 28 C 120 78, 240 12, 380 62"
                stroke={colors.primary}
                strokeWidth={2.5}
                strokeDasharray="2 12"
                strokeLinecap="round"
                strokeOpacity={0.14}
                fill="none"
              />
            </Svg>

            <View style={styles.compassWell}>
              <Compass size={24} color={colors.primary} strokeWidth={1.8} />
            </View>

            <View style={styles.badge}>
              <Text style={styles.badgeLabel}>Guided tours</Text>
            </View>
          </View>

          <View style={styles.seam} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Svg width="100%" height={2}>
              <Line x1={0} y1={1} x2="100%" y2={1} stroke={colors.border} strokeWidth={2} strokeDasharray="2 12" />
            </Svg>
          </View>

          <View style={[styles.body, pressed && styles.bodyPressed]}>
            {!pressed && (
              <LinearGradient colors={colors.surfaceGradient} style={StyleSheet.absoluteFill} pointerEvents="none" />
            )}

            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            <Text style={styles.attribution}>Tours and booking by GetYourGuide.</Text>
            {/* --text-muted, not --text-disabled: a disclosure has to be
                legible. Disabled tan is 2.6:1 on this surface — the hierarchy
                below the attribution comes from size, never from a color that
                fails AA. */}
            <Text style={styles.disclosure}>We may earn a commission from bookings.</Text>
            {failed && <Text style={styles.error}>Couldn&apos;t open your browser. Try again.</Text>}

            <View style={styles.metaRow}>
              <View style={styles.metaLeft}>
                <ExternalLink size={15} color={colors.primary} strokeWidth={1.75} />
                <Text style={styles.metaText} numberOfLines={1}>
                  Opens in your browser
                </Text>
              </View>
              <View style={styles.goCircle}>
                <ArrowRight size={17} color={colors.ink} strokeWidth={2.4} />
              </View>
            </View>
          </View>

          <View style={styles.notchLeft} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          <View style={styles.notchRight} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />

          {PARTNER_MARK !== null && (
            <View style={styles.stamp} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Image source={PARTNER_MARK} style={styles.stampMark} resizeMode="contain" />
            </View>
          )}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderTopColor: colors.cardHighlight,
    borderRadius: radius.lg,
    overflow: 'hidden',
    outlineStyle: 'solid',
    outlineWidth: 0,
  },
  cardFocused: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  stub: {
    width: '100%',
    height: STUB_HEIGHT,
    // ponytail: --bg, not the mock's #6E1C22 — the body gradient above it is
    // lighter, so the page-background wine already reads as recessed. One
    // fewer palette token to introduce and keep in sync.
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compassWell: {
    width: COMPASS_WELL,
    height: COMPASS_WELL,
    borderRadius: radius.full,
    backgroundColor: 'rgba(206,144,66,0.14)',
    borderWidth: 1,
    borderColor: colors.cardHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: space[3],
    left: space[3],
    backgroundColor: colors.scrim,
    borderRadius: radius.full,
    paddingVertical: space[1],
    paddingHorizontal: space[2],
  },
  badgeLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.text,
  },
  seam: {
    width: '100%',
    height: 2,
    paddingHorizontal: NOTCH_SIZE,
  },
  notchLeft: {
    position: 'absolute',
    left: -NOTCH_SIZE / 2,
    top: STUB_HEIGHT - NOTCH_SIZE / 2,
    width: NOTCH_SIZE,
    height: NOTCH_SIZE,
    borderRadius: NOTCH_SIZE / 2,
    backgroundColor: colors.bg,
  },
  notchRight: {
    position: 'absolute',
    right: -NOTCH_SIZE / 2,
    top: STUB_HEIGHT - NOTCH_SIZE / 2,
    width: NOTCH_SIZE,
    height: NOTCH_SIZE,
    borderRadius: NOTCH_SIZE / 2,
    backgroundColor: colors.bg,
  },
  // Straddles the perforation, right-inset — centred would compete with the
  // compass above it.
  stamp: {
    position: 'absolute',
    right: space[4] + 2,
    top: STUB_HEIGHT - 15,
    height: 30,
    borderRadius: radius.full,
    backgroundColor: colors.attributionPlate,
    borderWidth: 1,
    borderColor: colors.cardHighlight,
    paddingHorizontal: space[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  stampMark: {
    height: 20,
    width: 76,
  },
  body: {
    padding: space[4],
    gap: space[1],
  },
  bodyPressed: {
    backgroundColor: colors.surfaceHover,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.text,
  },
  attribution: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  disclosure: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  error: {
    fontSize: fontSize.sm,
    color: colors.error,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space[2],
  },
  metaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    flexShrink: 1,
  },
  metaText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    flexShrink: 1,
  },
  goCircle: {
    width: GO_BUTTON_SIZE,
    height: GO_BUTTON_SIZE,
    borderRadius: GO_BUTTON_SIZE / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
