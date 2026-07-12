export type Scope = 'home' | 'nearby' | 'outside_country';

export type Coordinates = {
  latitude: number;
  longitude: number;
};

// The shape a follow-on screen (T4's activity list) plugs into: which scope
// was picked, plus device coordinates when the scope is `nearby`.
export type ScopeSelection = {
  scope: Scope;
  coordinates?: Coordinates;
};
