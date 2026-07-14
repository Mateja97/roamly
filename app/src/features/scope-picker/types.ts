export type Scope = 'nearby' | 'anywhere';

export type Coordinates = {
  latitude: number;
  longitude: number;
};

// The shape a follow-on screen (the activity list) plugs into: which scope
// was picked, plus device coordinates when available. Nearby always has
// coordinates by the time onScopeSelected fires; Anywhere carries them when
// device location was granted, and is undefined when denied/unavailable —
// Anywhere still works without an anchor (T2 contract), just with no
// distance filter downstream.
export type ScopeSelection = {
  scope: Scope;
  coordinates?: Coordinates;
};
