// ponytail: no home-location/settings screen exists yet (out of scope per
// product-tasks.md's Roadmap: "Server-side home-location persistence"), so
// `home` and `outside_country` scopes need *some* home location/country to
// query with. Hardcoded to T1's own seed-data anchor (Belgrade, Serbia) so
// the seeded catalog actually returns non-empty results out of the box —
// replace with a real user-configured value once a settings surface exists.
export const HOME_LOCATION = { lat: 44.8125, lng: 20.4612 };
export const HOME_COUNTRY = 'Serbia';
