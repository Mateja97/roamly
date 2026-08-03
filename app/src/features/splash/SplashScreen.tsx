import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { PrimaryTicket } from '../../components/PrimaryTicket';
import { Wordmark } from '../../components/Wordmark';
import { colors, fontFamily, fontSize, space } from '../../theme/tokens';
import { FlightPathBackground } from '../scope-picker/FlightPathBackground';
import { markSplashSeen } from '../../utils/firstLaunch';

type SplashScreenProps = {
  /** Advances to the Feed. T1 builds this screen only — the App-root routing
   * decision of "show Splash vs. Feed at all" is T4's job. */
  onContinue: () => void;
};

// design-spec.md T1's exact spacing scale (deviations from the 4px token
// scale, explicitly named there): 66 top padding to the brand block, 20
// screen gutter + destination-block internal gap, 12 overline->hero, 16
// hero->underline, 34 bottom spacer.
const TOP_PADDING = 66;
const GUTTER = 20;
// Spec tension, not settled here (review round 1, Minor): the source spec's
// "destination-block internal gap 20px" reads as internal to the
// destination field, but design-spec.md T1's own prose puts 12px between
// the tagline and the "Destination" overline instead. Applied as the gap
// from the brand block (Wordmark+tagline) down to the destination field —
// the tie-break documented in engineering-notes.md — pending the designer
// settling which of the two docs is wrong.
const DESTINATION_BLOCK_GAP = 20;
const OVERLINE_TO_HERO_GAP = 12;
const HERO_TO_UNDERLINE_GAP = 16;
const BOTTOM_SPACER = 34;
// Not a spec-named value — the room the glow's radial fade needs to bleed
// above the CTA card instead of being fully occluded by it (review round 1,
// Important #1).
const GLOW_BLEED = space[6];

// First-launch-only branded splash (T1): reuses FlightPathBackground and
// Wordmark unchanged, Marcellus "Where to?" hero (36px per the spec's
// permanent Decision 7 deviation, not the Design System's 26px token), and
// the new Primary ticket CTA. No loading/error state — the CTA only
// navigates, it makes no request of its own.
export function SplashScreen({ onContinue }: SplashScreenProps) {
  const [headlineWidth, setHeadlineWidth] = useState(0);
  function onHeadlineLayout(event: LayoutChangeEvent) {
    setHeadlineWidth(event.nativeEvent.layout.width);
  }

  function handleContinue() {
    // Fire-and-forget: the CTA navigates immediately (no in-flight state,
    // per design-spec.md T1) — a slow/failed local write shouldn't stall
    // navigation, and the worst case is the splash showing once more.
    markSplashSeen().catch(() => {});
    onContinue();
  }

  return (
    <SafeAreaView style={styles.screen}>
      <FlightPathBackground />
      <View style={styles.content}>
        <View style={styles.brandBlock}>
          <Wordmark width={246} />
          <Text style={styles.tagline}>Search activities to do</Text>
        </View>

        <View style={styles.destinationField}>
          <Text style={styles.overline}>Destination</Text>
          <Text
            style={[styles.headline, { fontFamily: fontFamily.display }]}
            onLayout={onHeadlineLayout}
          >
            Where to?
          </Text>
          {headlineWidth > 0 && (
            <Svg width={headlineWidth} height={4} style={styles.underline}>
              <Line
                x1={0}
                y1={2}
                x2={headlineWidth}
                y2={2}
                stroke={colors.cardHighlight}
                strokeWidth={2}
                strokeDasharray="4 4"
                strokeLinecap="round"
              />
            </Svg>
          )}
        </View>

        <View style={styles.spacer} />

        <View style={styles.ctaGlowWrap}>
          <LinearGradient
            colors={[colors.glow, 'transparent']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <PrimaryTicket
            title="Start exploring"
            subtitle="Real places, picked for right now"
            accessibilityLabel="Start exploring, real places picked for right now"
            onPress={handleContinue}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
    paddingHorizontal: GUTTER,
    paddingTop: TOP_PADDING,
    paddingBottom: BOTTOM_SPACER,
  },
  brandBlock: {
    alignItems: 'center',
  },
  tagline: {
    marginTop: space[3],
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.textOverline,
    textTransform: 'uppercase',
    letterSpacing: 2.75, // ~0.22em at 12.5px
    textAlign: 'center',
  },
  destinationField: {
    alignItems: 'center',
    marginTop: DESTINATION_BLOCK_GAP,
  },
  overline: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.textOverline,
    textTransform: 'uppercase',
    letterSpacing: 2.75,
  },
  headline: {
    marginTop: OVERLINE_TO_HERO_GAP,
    fontSize: fontSize.xxl,
    lineHeight: fontSize.xxl * 1.1,
    color: colors.text,
    textAlign: 'center',
  },
  underline: {
    marginTop: HERO_TO_UNDERLINE_GAP,
  },
  spacer: {
    flex: 1,
  },
  // review round 1, Important #1: the gradient is `absoluteFill` on this
  // wrapper — sizing the wrapper to the opaque card's exact bounds left
  // 100% of the glow hidden behind it. GLOW_BLEED extends the wrapper
  // above the card so the top band of the radial fade shows over --bg.
  ctaGlowWrap: {
    paddingTop: GLOW_BLEED,
  },
});
