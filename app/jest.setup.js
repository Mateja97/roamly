/* global jest */
import { AccessibilityInfo, Dimensions } from 'react-native';

// T3: useWindowDimensions() is now the app's only source of pager width
// (react-native-safe-area-context's frame latches its width once at mount
// and never re-measures on web — see HeroCarousel.tsx's comment). Set it
// explicitly rather than trust RN's own jest-preset default, so it's the
// same 320 the swipe/momentum-scroll tests below were already written
// against (contentOffset.x: 320 assuming one page over at width 320).
Dimensions.set({ window: { width: 320, height: 640, scale: 2, fontScale: 1 } });

// react-native-safe-area-context needs a real on-screen layout pass to
// measure insets, which the Jest environment never performs — mock it with
// fixed zero insets so SafeAreaProvider/SafeAreaView render their children
// synchronously instead of waiting on a measurement that never arrives.
// Everything the factory needs must be required/declared inside it —
// babel-plugin-jest-hoist forbids referencing outer-scope variables here.
jest.mock('react-native-safe-area-context', () => {
  // babel-plugin-jest-hoist forbids referencing outer-scope variables (e.g. a top-level
  // import) inside a jest.mock factory; it must require its own dependencies internally.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see comment above
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see comment above
  const { View } = require('react-native');
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  // T3: deliberately 0, not a plausible screen width — nothing in
  // production code reads this frame's width anymore (only insets), and
  // 0 mirrors the real bug's latched-at-mount value. If a page's width
  // ever regresses to reading this frame again, HeroCarousel.test.tsx's
  // "sizes each page..." test catches it (page would render at 0, not the
  // 320 that Dimensions.set above provides via useWindowDimensions).
  const frame = { x: 0, y: 0, width: 0, height: 640 };

  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children, ...props }) => React.createElement(View, props, children),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    SafeAreaInsetsContext: React.createContext(insets),
    SafeAreaFrameContext: React.createContext(frame),
    initialWindowMetrics: { insets, frame },
  };
});

// AccessibilityInfo.isReduceMotionEnabled() returns undefined (not a Promise) in
// the Jest environment — every reduce-motion effect across the app calls
// `.isReduceMotionEnabled().then(...)`, which throws synchronously without this.
// Assigned as plain functions (not jest.fn()) so `jest.resetAllMocks()` /
// `jest.restoreAllMocks()` in individual test files' afterEach hooks can't wipe
// them back to undefined mid-suite — React Native's own jest preset already
// auto-mocks AccessibilityInfo.addEventListener as a jest.fn() (returning a
// `{ remove }` subscription by default), and a resetAllMocks() call anywhere in
// the same test file strips that default, making it return undefined and
// crashing the same reduce-motion effect's unmount cleanup (`sub.remove()`).
AccessibilityInfo.isReduceMotionEnabled = () => Promise.resolve(false);
AccessibilityInfo.addEventListener = () => ({ remove: () => {} });

// The package's own official in-memory mock — every local-flag module
// (T1's firstLaunch.ts, T3's nearbyNudge.ts/travelerMode.ts) reads/writes
// real AsyncStorage, which has no native module in the Jest environment.
// babel-plugin-jest-hoist forbids referencing outer-scope variables inside a jest.mock
// factory; it must require its own dependency internally.
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see comment above
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
