import { useState } from 'react';
import { ActivityListScreen } from './src/features/activity-list/ActivityListScreen';
import type { Category } from './src/features/activity-list/types';
import { ActivityTypesScreen } from './src/features/activity-types/ActivityTypesScreen';
import { CITY_LOCATION_CONFIG, COUNTRY_LOCATION_CONFIG } from './src/features/location/config';
import { LocationScreen } from './src/features/location/LocationScreen';
import { ScopePickerScreen } from './src/features/scope-picker/ScopePickerScreen';
import type { ScopeSelection } from './src/features/scope-picker/types';

// ponytail: a plain useState back-stack (array), not a router — this is a
// linear flow (scope -> [location, home/my_country only] -> types ->
// list) with no non-linear jumps. Each screen switch replaces the whole tree
// (no shared layout/transition), so an array of screens gives forward (push)
// and back (pop) without a navigation library. Add React Navigation only if
// a non-linear jump or a shared chrome/transition need shows up (see
// APP_STANDARDS.md).
type Screen =
  | { name: 'scope-picker' }
  | { name: 'location'; scope: 'home' | 'my_country' }
  | { name: 'activity-types'; selection: ScopeSelection }
  | { name: 'activity-list'; selection: ScopeSelection; categories: Category[] };

export default function App() {
  const [stack, setStack] = useState<Screen[]>([{ name: 'scope-picker' }]);
  const screen = stack[stack.length - 1];

  function push(next: Screen) {
    setStack((prev) => [...prev, next]);
  }

  // The location, types, and list screens all wire this to Android's
  // hardware back button (a real native affordance, not a custom control) —
  // there is no stack navigator installed to provide the native back
  // gesture/transition itself. See LocationScreen.tsx/ActivityTypesScreen.tsx/
  // ActivityListScreen.tsx and engineering-notes.md.
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

  if (screen.name === 'location') {
    const scope = screen.scope;
    const config = scope === 'home' ? CITY_LOCATION_CONFIG : COUNTRY_LOCATION_CONFIG;
    return (
      <LocationScreen
        config={config}
        onBack={pop}
        onConfirm={(place) =>
          push({
            name: 'activity-types',
            selection:
              scope === 'home'
                ? { scope: 'home', homeLocation: place.coordinates }
                : { scope: 'my_country', homeCountry: place.name },
          })
        }
      />
    );
  }

  return (
    <ScopePickerScreen
      onScopeSelected={(selection) => {
        // Nearby always has its coordinates by the time onScopeSelected
        // fires (ScopePickerScreen only calls it once requestLocation
        // resolves). my_country can fire either with a homeCountry already
        // resolved (skip straight to activity-types, like Nearby) or
        // without one (detection hasn't resolved yet, or failed) — that
        // case still needs the manual Location confirm screen.
        if (selection.scope === 'nearby' || (selection.scope === 'my_country' && selection.homeCountry)) {
          push({ name: 'activity-types', selection });
          return;
        }
        push({ name: 'location', scope: selection.scope });
      }}
    />
  );
}
