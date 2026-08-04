import { boolFlag } from '../../utils/boolFlag';

// design-spec.md's Persistence section: "nearby-nudge-dismissed flag" —
// "Dismissal persists for the install." Same shared boolFlag() helper as
// firstLaunch.ts's `hasSeenSplash`/`markSplashSeen`.
const flag = boolFlag('roamly:nearby-nudge-dismissed');

export const isNearbyNudgeDismissed = flag.read;
export const dismissNearbyNudge = flag.write;
