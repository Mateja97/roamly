import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityListScreen } from './src/features/activity-list/ActivityListScreen';
import type { Category } from './src/features/activity-list/types';
import { ActivityTypesScreen } from './src/features/activity-types/ActivityTypesScreen';
import { ScopePickerScreen } from './src/features/scope-picker/ScopePickerScreen';
import type { ScopeSelection } from './src/features/scope-picker/types';

// ponytail: a plain useState back-stack (array), not a router — this is a
// linear flow (scope -> types -> list) with no non-linear jumps. Each screen
// switch replaces the whole tree (no shared layout/transition), so an array
// of screens gives forward (push) and back (pop) without a navigation
// library. Add React Navigation only if a non-linear jump or a shared
// chrome/transition need shows up (see APP_STANDARDS.md).
type Screen =
  | { name: 'scope-picker' }
  | { name: 'activity-types'; selection: ScopeSelection }
  | { name: 'activity-list'; selection: ScopeSelection; categories: Category[] };

function AppContent() {
  const [stack, setStack] = useState<Screen[]>([{ name: 'scope-picker' }]);
  const screen = stack[stack.length - 1];

  function push(next: Screen) {
    setStack((prev) => [...prev, next]);
  }

  // The types and list screens both wire this to Android's hardware back
  // button (a real native affordance, not a custom control) — there is no
  // stack navigator installed to provide the native back gesture/transition
  // itself. See ActivityTypesScreen.tsx/ActivityListScreen.tsx and
  // engineering-notes.md.
  function pop() {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }

  if (screen.name === 'activity-list') {
    return (
      <ActivityListScreen selection={screen.selection} initialCategories={screen.categories} onBack={pop} />
    );
  }

  if (screen.name === 'activity-types') {
    return (
      <ActivityTypesScreen
        onConfirm={(categories) => push({ name: 'activity-list', selection: screen.selection, categories })}
        onBack={pop}
      />
    );
  }

  return (
    <ScopePickerScreen
      onScopeSelected={(selection) => push({ name: 'activity-types', selection })}
    />
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}
