export type Scope = 'home' | 'nearby' | 'my_country';

export type Coordinates = {
  latitude: number;
  longitude: number;
};

// The shape a follow-on screen (the activity list) plugs into: which scope
// was picked, plus device coordinates when the scope is `nearby`, or the
// place confirmed via T4's Location screen for `home`, or GPS-detected for
// `my_country` (falling back to the same Location screen on detection
// failure — see useMyCountryLocation.ts).
export type ScopeSelection = {
  scope: Scope;
  coordinates?: Coordinates;
  homeLocation?: { lat: number; lng: number };
  homeCountry?: string;
};
