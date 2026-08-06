import { useState } from 'react';
import { AccessibilityInfo, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
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

// The Tours & Experiences entry point. Why the category is served by an
// outbound referral instead of rows, and why the card carries no partner
// content, is stated once in toursPartner.ts and BUSINESS_STANDARDS.md —
// not repeated here.
//
// Built on the Activity card's torn-ticket anatomy (DESIGN_STANDARDS.md) with
// the photo well replaced by a 104px stub: partner imagery may not be stored,
// and a stock photo would imply a specific tour Roamly isn't selling.
// `city` drives the copy, `query` drives the link — they are deliberately
// separate. Outside cities with confirmed inventory the card stops naming a
// place (so it promises nothing GetYourGuide can't deliver) while the link
// widens to the country, where the results actually are. See tourTarget().
export function ToursTicket({ city, query }: { city: string | null; query: string | null }) {
  const focus = useFocusable();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const title = city ? `Book a guided tour in ${city}` : 'Book a guided tour';
  const url = toursDeepLink(query);

  // Busy-gated for the duration of the handoff — APP_STANDARDS.md's "disable
  // a control for the duration of its own async action". Without it, repeat
  // taps fire one browser handoff each. Same shape as useOSHandoff's ctaBusy,
  // inlined rather than reused because that hook is scoped to an Activity.
  async function handlePress() {
    if (busy || url === null) return;
    setFailed(false);
    setBusy(true);
    try {
      // Rejects only when no handler can open an https URL (effectively no
      // browser present). Rare, but an unhandled branch is a bug per
      // APP_STANDARDS.md — surface it on the card instead of failing silently.
      await Linking.openURL(url);
    } catch {
      setFailed(true);
      // Swapping the label doesn't make a screen reader re-read an already
      // focused element, so the moment of failure would otherwise be silent.
      AccessibilityInfo.announceForAccessibility("Couldn't open your browser. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // No partner id means no attributable link, so render nothing rather than a
  // control that silently no-ops. ActivityListScreen already gates on
  // hasPartnerId(); this makes the component safe for any future caller too.
  if (url === null) return null;

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
                <Text style={[styles.metaText, failed && styles.metaFailed]} numberOfLines={failed ? 2 : 1}>
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
  // Cream, not --error: coral is 4.16:1 on --surface-hover (the pressed
  // background), below AA. The coral icon carries the error semantic at the
  // 3:1 UI bar instead.
  metaFailed: {
    color: colors.text,
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
