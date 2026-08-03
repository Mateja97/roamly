import AsyncStorage from '@react-native-async-storage/async-storage';

// design-spec.md's Persistence section: "nearby-nudge-dismissed flag" —
// "Dismissal persists for the install." ponytail: same one-line-read/write
// shape as T1's firstLaunch.ts (`hasSeenSplash`/`markSplashSeen`) — T1 hasn't
// merged into this branch's `main` yet, so this is a fresh small duplicate of
// that shape rather than a reuse; fold into one shared "local flag" helper
// once both land on the same base and the duplication is visible in one diff.
const NEARBY_NUDGE_DISMISSED_KEY = 'roamly.nearbyNudgeDismissed';

export async function isNearbyNudgeDismissed(): Promise<boolean> {
  return (await AsyncStorage.getItem(NEARBY_NUDGE_DISMISSED_KEY)) === 'true';
}

export async function dismissNearbyNudge(): Promise<void> {
  await AsyncStorage.setItem(NEARBY_NUDGE_DISMISSED_KEY, 'true');
}
