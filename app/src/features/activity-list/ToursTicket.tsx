import { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Line, Path } from 'react-native-svg';
import { ArrowRight, Compass, ExternalLink, TriangleAlert } from 'lucide-react-native';
import { GetYourGuideLogo } from '../../components/GetYourGuideLogo';
import { useFocusable } from '../../hooks/useFocusable';
import { colors, fontSize, radius, space } from '../../theme/tokens';
import { toursDeepLink } from './toursPartner';

const STUB_HEIGHT = 104;
const NOTCH_SIZE = 16;
const GO_BUTTON_SIZE = 38;
const COMPASS_WELL = 52;

// The issuer stamp is a round seal, not the pill the design-spec first drew.
// GetYourGuide's mark is a three-line stacked lockup (382x302), so a 20px-tall
// pill would put each line's cap height under 5px — unreadable, and showing a
// partner's mark at an illegible size is its own kind of distortion. At 32px
// the lockup reads, and a near-square mark sits better in a circle than in a
// pill anyway: it lands as a wax seal on the ticket's perforation.
const SEAL_SIZE = 48;
const SEAL_MARK_HEIGHT = 32;

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
  const [busy, setBusy] = useState(false);
  // The guard has to be a ref, not the state above: several taps in one tick
  // all close over the same `busy === false`, so state alone lets every one
  // of them through. State still drives `disabled` for the visual/AT state.
  const busyRef = useRef(false);

  const title = city ? `Book a guided tour in ${city}` : 'Book a guided tour';
  const url = toursDeepLink(city);

  // Busy-gated for the duration of the handoff — APP_STANDARDS.md's
  // "disable a control for the duration of its own async action" is a
  // correctness rule, and without it repeat taps fire one browser handoff
  // each. Same shape as useOSHandoff's ctaBusy, inlined rather than reused
  // because that hook is scoped to an Activity and this card has none.
  async function handlePress() {
    if (busyRef.current || url === null) return;
    busyRef.current = true;
    setFailed(false);
    setBusy(true);
    try {
      // Rejects only when no handler can open an https URL (effectively no
      // browser present). Rare, but an unhandled branch is a bug per
      // APP_STANDARDS.md — surface it on the card instead of failing silently.
      await Linking.openURL(url);
    } catch {
      setFailed(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Pressable
      onPress={handlePress}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      disabled={busy}
      // "link", not "button" — it leaves the app, matching every other
      // Linking.openURL control here (PhotoAttributionCaption,
      // GoogleAttributionPlate).
      accessibilityRole="link"
      // Pressable groups its subtree into one node, so the failure Text below
      // can never be focused or announced on its own. Folding it into the
      // card's own name is what makes the failure reach a screen reader at all.
      accessibilityLabel={
        failed
          ? `${title}. Couldn't open your browser. Try again.`
          : `${title}. Opens GetYourGuide in your browser.`
      }
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

            {/* The failure takes over the meta row's own slot rather than
                adding a line: no layout shift on a rare state, and it lands
                where the eye already is after a tap. Cream text, not coral —
                --error is 4.16:1 on --surface-hover (the pressed background),
                below AA, and no error-tinted token clears it. The coral icon
                carries the error semantic instead, which only needs the 3:1
                UI bar; relying on colour alone would fail WCAG 1.4.1 anyway. */}
            <View style={styles.metaRow}>
              <View style={styles.metaLeft}>
                {failed ? (
                  <TriangleAlert size={15} color={colors.error} strokeWidth={1.75} />
                ) : (
                  <ExternalLink size={15} color={colors.primary} strokeWidth={1.75} />
                )}
                <Text style={failed ? styles.metaError : styles.metaText} numberOfLines={1}>
                  {failed ? "Couldn't open your browser. Try again." : 'Opens in your browser'}
                </Text>
              </View>
              <View style={styles.goCircle}>
                <ArrowRight size={17} color={colors.ink} strokeWidth={2.4} />
              </View>
            </View>
          </View>

          <View style={styles.notchLeft} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          <View style={styles.notchRight} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />

          <View style={styles.stamp} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <GetYourGuideLogo height={SEAL_MARK_HEIGHT} />
          </View>
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
  // compass above it. The white fill is the partner's own asset requirement,
  // not decoration: their orange mark has no contrast against wine.
  stamp: {
    position: 'absolute',
    right: space[4],
    top: STUB_HEIGHT - SEAL_SIZE / 2,
    width: SEAL_SIZE,
    height: SEAL_SIZE,
    borderRadius: SEAL_SIZE / 2,
    backgroundColor: colors.attributionPlate,
    borderWidth: 1,
    borderColor: colors.cardHighlight,
    alignItems: 'center',
    justifyContent: 'center',
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
  metaError: {
    fontSize: fontSize.sm,
    color: colors.text,
    flexShrink: 1,
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
