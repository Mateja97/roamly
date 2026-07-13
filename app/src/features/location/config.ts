import type { LocationConfig } from './types';

// Moved from activity-list/config.ts's HOME_LOCATION/HOME_COUNTRY constants
// (T1's seed-data anchor: Belgrade, Serbia) — now an editable, confirmable
// default shown on the Location screen instead of a hidden constant (T4).
export const CITY_LOCATION_CONFIG: LocationConfig = {
  mode: 'city',
  headerTitle: 'Confirm your city',
  inputLabel: 'City',
  placeholder: 'Search for a city',
  defaultPlace: { name: 'Belgrade', region: 'Serbia', coordinates: { lat: 44.8125, lng: 20.4612 } },
};

export const COUNTRY_LOCATION_CONFIG: LocationConfig = {
  mode: 'country',
  headerTitle: 'Confirm your country',
  inputLabel: 'Country',
  placeholder: 'Search for a country',
  defaultPlace: { name: 'Serbia' },
};
