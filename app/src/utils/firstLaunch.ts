import AsyncStorage from '@react-native-async-storage/async-storage';

// ponytail: no local-storage mechanism existed anywhere in the app before
// this task (checked src/utils and src/hooks per design-spec.md T1's own
// note) despite the design-spec assuming one — `@react-native-async-storage/
// async-storage` is Expo's own documented answer for exactly this ("a
// first-launch-seen flag"), so it's added as the one real dependency this
// needs rather than faked with an in-memory flag that would reset on every
// app restart and silently fail the "splash renders once ever" requirement.
// T3/T5 reuse this same key-value primitive for their own flags
// (nearby-nudge-dismissed, home-base samples) — no per-feature storage
// abstraction, just the one already-installed library, called directly.
const FIRST_LAUNCH_SEEN_KEY = 'roamly:first-launch-seen';

// Without this catch, a rejecting AsyncStorage read leaves the
// caller's own .then never firing, permanently blank. A failed read is
// indistinguishable from "never written", so it falls back
// to "unseen" (shows Splash), same default a fresh install gets from
// AsyncStorage's own null-on-not-found semantics. The App.tsx call site adds
// its own .catch as a second backstop (belt and suspenders, cheap).
export async function hasSeenSplash(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(FIRST_LAUNCH_SEEN_KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function markSplashSeen(): Promise<void> {
  await AsyncStorage.setItem(FIRST_LAUNCH_SEEN_KEY, 'true');
}
