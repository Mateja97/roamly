import { useState } from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { ScopePickerScreen } from './src/features/scope-picker/ScopePickerScreen';
import { colors, fontSize, space } from './src/theme/tokens';
import type { ScopeSelection } from './src/features/scope-picker/types';

// ponytail: a plain useState screen-switch, not a router — this is a linear
// 2-screen flow (T3 picks a scope, T4 lists activities for it). Add
// React Navigation only if a third route/back-stack need shows up (see
// APP_STANDARDS.md).
type Screen = { name: 'scope-picker' } | { name: 'activity-list'; selection: ScopeSelection };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'scope-picker' });

  if (screen.name === 'activity-list') {
    // T4 builds the real list screen against `screen.selection`; this is the
    // placeholder that proves the hand-off works end to end.
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.stub}>
          <Text style={styles.title}>Scope selected: {screen.selection.scope}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return <ScopePickerScreen onScopeSelected={(selection) => setScreen({ name: 'activity-list', selection })} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  stub: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
  },
});
