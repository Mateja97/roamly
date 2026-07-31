package placesmap

import "testing"

func TestCityCountry(t *testing.T) {
	tests := []struct {
		name        string
		components  []AddressComponent
		wantCity    string
		wantCountry string
	}{
		{
			name: "realistic Belgrade response",
			components: []AddressComponent{
				{LongText: "11", ShortText: "11", Types: []string{"street_number"}},
				{LongText: "Kneza Mihaila", ShortText: "Kneza Mihaila", Types: []string{"route"}},
				{LongText: "Stari Grad", ShortText: "Stari Grad", Types: []string{"sublocality_level_1", "sublocality", "political"}},
				{LongText: "Belgrade", ShortText: "Belgrade", Types: []string{"locality", "political"}},
				{LongText: "Serbia", ShortText: "RS", Types: []string{"country", "political"}},
				{LongText: "11000", ShortText: "11000", Types: []string{"postal_code"}},
			},
			wantCity:    "Belgrade",
			wantCountry: "Serbia",
		},
		{
			name: "no locality falls back to postal_town",
			components: []AddressComponent{
				{LongText: "High Street", Types: []string{"route"}},
				{LongText: "Reading", Types: []string{"postal_town"}},
				{LongText: "United Kingdom", Types: []string{"country", "political"}},
			},
			wantCity:    "Reading",
			wantCountry: "United Kingdom",
		},
		{
			name:        "no components at all yields empty, never a guess",
			components:  nil,
			wantCity:    "",
			wantCountry: "",
		},
		{
			name: "locality present takes priority over postal_town",
			components: []AddressComponent{
				{LongText: "Some Town", Types: []string{"postal_town"}},
				{LongText: "Real City", Types: []string{"locality", "political"}},
			},
			wantCity:    "Real City",
			wantCountry: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			city, country := CityCountry(tt.components)
			if city != tt.wantCity || country != tt.wantCountry {
				t.Errorf("CityCountry() = (%q, %q), want (%q, %q)", city, country, tt.wantCity, tt.wantCountry)
			}
		})
	}
}
