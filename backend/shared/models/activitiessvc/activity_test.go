package activitiessvc

import "testing"

func TestCategoryValid(t *testing.T) {
	if !CategoryCafes.Valid() {
		t.Error("cafes should be valid")
	}
	if Category("food_and_drink").Valid() {
		t.Error("retired category should be invalid")
	}
	if Category("").Valid() {
		t.Error("empty category should be invalid")
	}
}
