import { MapPin } from 'lucide-react';
import { TextField } from './controls/TextField';
import { ImageSlot } from './controls/ImageSlot';
import { hasValidCoordinates, staticMapUrl } from '../../../api/staticMap';
import type { Location } from '../../../api/adminActivities';

export interface LocationSectionProps {
  address: string;
  onAddressChange: (value: string) => void;
  /** Shares the same value/setter as `BasicsSection`'s City field — the
   * mock shows a city input in both cards, but it's one piece of data, not
   * two sources of truth for it. */
  city: string;
  onCityChange: (value: string) => void;
  location: Location | undefined;
  disabled?: boolean;
}

/** Address + city, plus a read-only static map preview of the stored
 * `location` lat/lng. No geocoding, no picker — omitted entirely when
 * there are no valid coordinates (Create mode, or an activity that never
 * got one — see T4's backend-contract gap note in engineering-notes.md). */
export function LocationSection({
  address,
  onAddressChange,
  city,
  onCityChange,
  location,
  disabled,
}: LocationSectionProps) {
  const showMap = hasValidCoordinates(location);

  return (
    <section className="admin-card admin-section">
      <h2 className="admin-section-heading">Location</h2>
      <div className="admin-basics-row">
        <TextField
          label="Address"
          value={address}
          onChange={onAddressChange}
          disabled={disabled}
        />
        <TextField
          label="City"
          value={city}
          onChange={onCityChange}
          disabled={disabled}
        />
      </div>
      {showMap && (
        <div className="admin-map-wrapper">
          <ImageSlot
            src={staticMapUrl(location, 600, 130)}
            alt="Map showing the activity location"
            className="admin-map-box"
          />
          <MapPin
            className="admin-map-pin"
            size={28}
            aria-hidden="true"
            strokeWidth={2}
          />
        </div>
      )}
    </section>
  );
}
