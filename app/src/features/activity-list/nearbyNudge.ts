import AsyncStorage from '@react-native-async-storage/async-storage';

// design-spec.md's Persistence section: "nearby-nudge-dismissed flag" —
// "Dismissal persists for the install." Same direct-AsyncStorage,
// one-line-read/write convention as T1's firstLaunch.ts (`hasSeenSplash`/
// `markSplashSeen`) — per that file's own comment, each local flag calls
// AsyncStorage directly with its own key rather than sharing a wrapper.
const NEARBY_NUDGE_DISMISSED_KEY = 'roamly:nearby-nudge-dismissed';

export async function isNearbyNudgeDismissed(): Promise<boolean> {
  return (await AsyncStorage.getItem(NEARBY_NUDGE_DISMISSED_KEY)) === 'true';
}

export async function dismissNearbyNudge(): Promise<void> {
  await AsyncStorage.setItem(NEARBY_NUDGE_DISMISSED_KEY, 'true');
}
