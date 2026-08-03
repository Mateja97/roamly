import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, Marcellus_400Regular } from '@expo-google-fonts/marcellus';
import type { Activity } from './src/api/activities';
import type { CitySuggestion } from './src/api/cities';
import { ActivityListScreen } from './src/features/activity-list/ActivityListScreen';
import type { Category } from './src/features/activity-list/types';
import { AnywhereSearchScreen } from './src/features/search-setup/AnywhereSearchScreen';
import { NearbySearchSetupScreen } from './src/features/search-setup/NearbySearchSetupScreen';
import { ScopePickerScreen } from './src/features/scope-picker/ScopePickerScreen';
import type { ScopeSelection } from './src/features/scope-picker/types';
import { colors } from './src/theme/tokens';

// ponytail: a plain useState back-stack (array), not a router — this is a
// linear flow (scope -> types -> list) with no non-linear jumps. Each screen
// switch replaces the whole tree (no shared layout/transition), so an array
// of screens gives forward (push) and back (pop) without a navigation
// library. Add React Navigation only if a non-linear jump or a shared
// chrome/transition need shows up (see APP_STANDARDS.md).
type Screen =
  | { name: 'scope-picker' }
  | { name: 'activity-types'; selection: ScopeSelection }
  | { name: 'anywhere-search'; selection: ScopeSelection }
  | { name: 'activity-list'; selection: ScopeSelection; categories: Category[]; activities?: Activity[]; cities?: CitySuggestion[] };

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
      <ActivityListScreen
        selection={screen.selection}
        initialCategories={screen.categories}
        initialActivities={screen.activities}
        initialCities={screen.cities}
        onBack={pop}
      />
    );
  }

  if (screen.name === 'anywhere-search') {
    return (
      <AnywhereSearchScreen
        selection={screen.selection}
        onBack={pop}
        onSearchComplete={(activities, categories, cities) =>
          push({ name: 'activity-list', selection: screen.selection, categories, activities, cities })
        }
      />
    );
  }

  // Only 'nearby' reaches 'activity-types' — 'anywhere' pushes straight to
  // its own 'anywhere-search' screen above.
  if (screen.name === 'activity-types') {
    const onConfirm = (categories: Category[]) =>
      push({ name: 'activity-list', selection: screen.selection, categories });
    return <NearbySearchSetupScreen selection={screen.selection} onConfirm={onConfirm} onBack={pop} />;
  }

  return (
    <ScopePickerScreen
      onScopeSelected={(selection) =>
        push(selection.scope === 'anywhere' ? { name: 'anywhere-search', selection } : { name: 'activity-types', selection })
      }
    />
  );
}

export default function App() {
  // Font-load gate (T1): every screen renders Marcellus headers, so this
  // gate lives once at the app root instead of duplicated per-screen (it
  // used to live in ScopePickerScreen alone). Hold first paint on a blank
  // wine background until the font resolves one way or the other, then
  // fall back to the system stack only if loading genuinely failed.
  const [fontsLoaded, fontError] = useFonts({ Marcellus_400Regular });

  return (
    <SafeAreaProvider>
      {fontsLoaded || fontError ? (
        <AppContent />
      ) : (
        <View style={{ flex: 1, backgroundColor: colors.bg }} />
      )}
    </SafeAreaProvider>
  );
}
