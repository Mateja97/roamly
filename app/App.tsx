import { useState } from 'react';
import { ActivityListScreen } from './src/features/activity-list/ActivityListScreen';
import { ScopePickerScreen } from './src/features/scope-picker/ScopePickerScreen';
import type { ScopeSelection } from './src/features/scope-picker/types';

// ponytail: a plain useState screen-switch, not a router — this is a linear
// 2-screen flow (T3 picks a scope, T4 lists activities for it). Add
// React Navigation only if a third route/back-stack need shows up (see
// APP_STANDARDS.md). `onBack` is a plain callback that returns to
// scope-picker; the list screen wires it to Android's hardware back button
// (a real native affordance, not a custom control) since there is no stack
// navigator installed to provide the native back gesture itself — see
// ActivityListScreen.tsx and T4's engineering notes.
type Screen = { name: 'scope-picker' } | { name: 'activity-list'; selection: ScopeSelection };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'scope-picker' });

  if (screen.name === 'activity-list') {
    return <ActivityListScreen selection={screen.selection} onBack={() => setScreen({ name: 'scope-picker' })} />;
  }

  return <ScopePickerScreen onScopeSelected={(selection) => setScreen({ name: 'activity-list', selection })} />;
}
