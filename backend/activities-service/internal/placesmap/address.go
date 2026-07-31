package placesmap

// CityCountry extracts City and Country from a discovered place's structured
// address (see Place.AddressComponents). City prefers the "locality"
// component, falling back to "postal_town" when a place has no locality —
// some Google-covered areas (notably parts of the UK) are addressed by
// postal town instead. Country is the "country" component's long name (e.g.
// "Serbia", not the short "RS"). Either return is "" when the place's
// address carries no matching component — never a guess.
//
// This is what feeds IngestActivity.City/Country for a sync-discovered row:
// without it, BuildLiveDetails' opening-hours timezone lookup
// (TimezoneForCity("")) always misses, and Upsert's ON CONFLICT would blank
// an existing row's city on rediscovery.
func CityCountry(components []AddressComponent) (city, country string) {
	var postalTown string
	for _, c := range components {
		for _, t := range c.Types {
			switch t {
			case "locality":
				if city == "" {
					city = c.LongText
				}
			case "postal_town":
				if postalTown == "" {
					postalTown = c.LongText
				}
			case "country":
				if country == "" {
					country = c.LongText
				}
			}
		}
	}
	if city == "" {
		city = postalTown
	}
	return city, country
}
