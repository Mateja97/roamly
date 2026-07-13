import type { Place } from '../../api/places';

export type LocationMode = 'city' | 'country';

export type LocationConfig = {
  mode: LocationMode;
  headerTitle: string;
  inputLabel: string;
  placeholder: string;
  defaultPlace: Place;
};

export type LocationScreenProps = {
  config: LocationConfig;
  onConfirm: (place: Place) => void;
  onBack: () => void;
};
