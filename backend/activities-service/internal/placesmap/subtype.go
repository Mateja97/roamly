package placesmap

import "backend/shared/models/activitiessvc"

// Subtype derives a subcategory slug for cat from a Places primaryType,
// falling back to the first mappable entry in types when primaryType itself
// doesn't map or its mapped subtype doesn't belong to cat. Returns "" when
// nothing maps — never a guess, matching ValidSubcategory's contract that ""
// is always a valid subcategory.
//
// The lookup table is DiscoveryRows read backward (see typeToSubtype), so
// discovery and classification can never drift apart. This is the path that
// labels venues the type-driven sync did NOT discover — Tripadvisor rows and
// phrase-discovered rows.
func Subtype(cat activitiessvc.Category, primaryType string, types []string) string {
	if sub, ok := typeToSubtype[primaryType]; ok && activitiessvc.ValidSubcategory(cat, sub) {
		return sub
	}
	for _, t := range types {
		if sub, ok := typeToSubtype[t]; ok && activitiessvc.ValidSubcategory(cat, sub) {
			return sub
		}
	}
	return ""
}
