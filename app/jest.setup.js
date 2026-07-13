// react-native-safe-area-context needs a real on-screen layout pass to
// measure insets, which the Jest environment never performs — mock it with
// fixed zero insets so SafeAreaProvider/SafeAreaView render their children
// synchronously instead of waiting on a measurement that never arrives.
// Everything the factory needs must be required/declared inside it —
// babel-plugin-jest-hoist forbids referencing outer-scope variables here.
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 320, height: 640 };

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
