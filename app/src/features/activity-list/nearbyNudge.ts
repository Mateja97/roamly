import AsyncStorage from '@react-native-async-storage/async-storage';

// design-spec.md's Persistence section: "nearby-nudge-dismissed flag" —
// "Dismissal persists for the install." Same direct-AsyncStorage,
// one-line-read/write convention as T1's firstLaunch.ts (`hasSeenSplash`/
// `markSplashSeen`) — per that file's own comment, each local flag calls
// AsyncStorage directly with its own key rather than sharing a wrapper.
const NEARBY_NUDGE_DISMISSED_KEY = 'roamly:nearby-nudge-dismissed';

// APP_STANDARDS.md Error handling: a rejected AsyncStorage call is handled
// here, once, rather than trusting every caller to remember its own
// `.catch` — a read failure just means "not dismissed yet" (safe default,
// same as never having dismissed).
export async function isNearbyNudgeDismissed(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(NEARBY_NUDGE_DISMISSED_KEY)) === 'true';
  } catch {
    return false;
  }
}

// A failed write silently drops the dismissal (the nudge may reappear next
// launch) rather than surfacing an error for a low-stakes, no-UI local flag.
export async function dismissNearbyNudge(): Promise<void> {
  try {
    await AsyncStorage.setItem(NEARBY_NUDGE_DISMISSED_KEY, 'true');
  } catch {
    // ponytail: swallowed — no UI reachable from this local-only flag to
    // surface a retry/error into; worst case the nudge shows again next launch.
  }
}
