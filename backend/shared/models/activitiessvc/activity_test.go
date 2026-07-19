package activitiessvc

import "testing"

func TestCategoryValid(t *testing.T) {
	if !CategoryCafes.Valid() {
		t.Error("cafes should be valid")
	}
	if !CategoryToursExperiences.Valid() {
		t.Error("tours_experiences should be valid")
	}
	if Category("food_and_drink").Valid() {
		t.Error("retired category should be invalid")
	}
	if Category("").Valid() {
		t.Error("empty category should be invalid")
	}
}

func TestValidSubcategory(t *testing.T) {
	tests := []struct {
		name string
		cat  Category
		sub  string
		want bool
	}{
		{"valid subtype for category", CategoryRestaurants, "fine_dining", true},
		{"wrong-category subtype", CategoryRestaurants, "cocktail_bar", false},
		{"empty subtype always valid", CategoryRestaurants, "", true},
		{"empty subtype valid for unknown category too", Category("bogus"), "", true},
		{"unknown subtype", CategoryRestaurants, "not_a_real_subtype", false},
		{"new category's own subtype", CategoryToursExperiences, "walking_tour", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ValidSubcategory(tt.cat, tt.sub); got != tt.want {
				t.Errorf("ValidSubcategory(%q, %q) = %v, want %v", tt.cat, tt.sub, got, tt.want)
			}
		})
	}
}
