import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Marcellus_400Regular } from '@expo-google-fonts/marcellus';
import { ActivityListScreen } from './src/features/activity-list/ActivityListScreen';
import { SplashScreen } from './src/features/splash/SplashScreen';
import { hasSeenSplash } from './src/utils/firstLaunch';
import { colors } from './src/theme/tokens';

type Screen = 'splash' | 'feed';

function AppContent() {
  // design-spec.md: "every later launch goes straight to Feed" — resolved
  // once at boot from the persisted flag (T1's firstLaunch.ts). Same shape
  // as the font gate below: hold a blank background for this one
  // near-instant AsyncStorage read, then pick Splash vs Feed for good — this
  // is not the "gate screen" the design invariant rules out (no dialog, no
  // decision put to the user), it's the same already-accepted mechanism T1
  // uses for the font load.
  const [screen, setScreen] = useState<Screen | null>(null);

  useEffect(() => {
    let cancelled = false;
    hasSeenSplash().then((seen) => {
      if (!cancelled) setScreen(seen ? 'feed' : 'splash');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (screen === null) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  if (screen === 'splash') {
    return <SplashScreen onContinue={() => setScreen('feed')} />;
  }

  // T4: Feed is the app's whole home now — no `onBack` (nothing to pop to;
  // see ActivityListScreen's own hardware-back handling for what an absent
  // onBack means for Android's back button). Scope always starts as
  // unanchored Anywhere — design-spec.md's deliberate broad cold-start query
  // (BUSINESS_STANDARDS.md's carve-out) — and ActivityListScreen's own
  // already-granted-permission effect silently promotes to a real Nearby
  // scope right after mount when the OS permission is already granted. This
  // is "scope derives from permission state at launch" without a pre-mount
  // gate: Feed paints immediately either way, no dialog, no reachable state
  // that blocks on a question before content appears.
  return <ActivityListScreen selection={{ scope: 'anywhere' }} />;
}

export default function App() {
  // Font-load gate (T1): every screen renders Marcellus headers, so this
  // gate lives once at the app root instead of duplicated per-screen.
  // Hold first paint on a blank wine background until the font resolves one
  // way or the other, then fall back to the system stack only if loading
  // genuinely failed.
  const [fontsLoaded, fontError] = useFonts({ Marcellus_400Regular });

  return (
    <SafeAreaProvider>
      {fontsLoaded || fontError ? (
        <AppContent />
      ) : (
        <View style={{ flex: 1, backgroundColor: colors.bg }} />
      )}
    </SafeAreaProvider>
  );
}
