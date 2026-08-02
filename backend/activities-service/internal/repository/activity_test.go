package repository

import (
	"strings"
	"testing"

	"backend/shared/models/activitiessvc"
)

func TestBuildQuery(t *testing.T) {
	tests := []struct {
		name       string
		filter     activitiessvc.QueryFilter
		wantErr    bool
		wantSQL    []string // substrings that must appear
		wantArgs   []any
		notWantSQL []string
	}{
		{
			name: "nearby scope uses ST_DWithin against current location and orders by distance",
			filter: activitiessvc.QueryFilter{
				Scope:           activitiessvc.ScopeNearby,
				CurrentLocation: &activitiessvc.Point{Lat: 1, Lng: 2},
				MaxDistanceKM:   10,
			},
			wantSQL:  []string{"ST_DWithin(location", "ORDER BY distance_km ASC"},
			wantArgs: []any{2.0, 1.0, 10.0 * 1000},
		},
		{
			name: "nearby scope missing location is an error",
			filter: activitiessvc.QueryFilter{
				Scope: activitiessvc.ScopeNearby,
			},
			wantErr: true,
		},
		{
			name: "anywhere scope with location and max_distance_km narrows with ST_DWithin",
			filter: activitiessvc.QueryFilter{
				Scope:           activitiessvc.ScopeAnywhere,
				CurrentLocation: &activitiessvc.Point{Lat: 44.8, Lng: 20.4},
				MaxDistanceKM:   200,
			},
			wantSQL:  []string{"ST_DWithin(location", "ORDER BY distance_km ASC"},
			wantArgs: []any{20.4, 44.8, 200.0 * 1000},
		},
		{
			name: "anywhere scope with location but no max_distance_km has no distance cap",
			filter: activitiessvc.QueryFilter{
				Scope:           activitiessvc.ScopeAnywhere,
				CurrentLocation: &activitiessvc.Point{Lat: 44.8, Lng: 20.4},
			},
			wantSQL:    []string{"ORDER BY distance_km ASC"},
			notWantSQL: []string{"ST_DWithin"},
			wantArgs:   []any{20.4, 44.8},
		},
		{
			name:       "anywhere scope with no location and no filters still filters to published, title order",
			filter:     activitiessvc.QueryFilter{Scope: activitiessvc.ScopeAnywhere},
			wantSQL:    []string{"WHERE status = 'published'", "ORDER BY title ASC"},
			notWantSQL: []string{"ST_DWithin"},
		},
		{
			name: "anywhere scope with cities unions ST_DWithin across each city and orders by distance",
			filter: activitiessvc.QueryFilter{
				Scope:         activitiessvc.ScopeAnywhere,
				Cities:        []activitiessvc.Point{{Lat: 41.9, Lng: 12.5}, {Lat: 48.85, Lng: 2.35}},
				MaxDistanceKM: 50,
			},
			wantSQL:  []string{"ST_DWithin(location", " OR ", "LEAST(", "ORDER BY distance_km ASC"},
			wantArgs: []any{12.5, 41.9, 50.0 * 1000, 2.35, 48.85, 50.0 * 1000},
		},
		{
			name: "anywhere scope with cities but no max_distance_km has no distance cap",
			filter: activitiessvc.QueryFilter{
				Scope:  activitiessvc.ScopeAnywhere,
				Cities: []activitiessvc.Point{{Lat: 41.9, Lng: 12.5}},
			},
			wantSQL:    []string{"LEAST(", "ORDER BY distance_km ASC"},
			notWantSQL: []string{"ST_DWithin"},
		},
		{
			name: "anywhere scope with cities and current_location ignores current_location for filtering",
			filter: activitiessvc.QueryFilter{
				Scope:           activitiessvc.ScopeAnywhere,
				CurrentLocation: &activitiessvc.Point{Lat: 44.8, Lng: 20.4},
				Cities:          []activitiessvc.Point{{Lat: 41.9, Lng: 12.5}},
				MaxDistanceKM:   50,
			},
			wantSQL:  []string{"ST_DWithin(location", "LEAST("},
			wantArgs: []any{12.5, 41.9, 50.0 * 1000}, // only the city's coords/radius, not current_location
		},
		{
			name: "unknown scope is an error",
			filter: activitiessvc.QueryFilter{
				Scope: activitiessvc.Scope("bogus"),
			},
			wantErr: true,
		},
		{
			name: "category filter narrows with ANY and skips the dedup wrapper",
			filter: activitiessvc.QueryFilter{
				Scope:      activitiessvc.ScopeAnywhere,
				Categories: []activitiessvc.Category{activitiessvc.CategorySport, activitiessvc.CategoryArt},
			},
			wantSQL:    []string{"category = ANY"},
			notWantSQL: []string{"DISTINCT ON", "deduped"},
		},
		{
			name: "no category filter wraps the query in a DISTINCT ON dedup, with the real ordering moved outside",
			filter: activitiessvc.QueryFilter{
				Scope:           activitiessvc.ScopeNearby,
				CurrentLocation: &activitiessvc.Point{Lat: 1, Lng: 2},
				MaxDistanceKM:   10,
			},
			wantSQL: []string{
				"DISTINCT ON (coalesce(nullif(external_id, ''), id::text))",
				"ORDER BY coalesce(nullif(external_id, ''), id::text), (subcategory <> '') DESC, id",
				") deduped",
				"ORDER BY distance_km ASC", // the caller's real ordering, now on the outer query
			},
		},
		{
			name: "min rating filter combines with AND alongside another filter",
			filter: activitiessvc.QueryFilter{
				Scope:      activitiessvc.ScopeAnywhere,
				Categories: []activitiessvc.Category{activitiessvc.CategorySport},
				MinRating:  4.5,
			},
			wantSQL: []string{"category = ANY", "rating >=", " AND "},
		},
		{
			name: "subcategory filter narrows with ANY and AND-s with category filter",
			filter: activitiessvc.QueryFilter{
				Scope:         activitiessvc.ScopeAnywhere,
				Categories:    []activitiessvc.Category{activitiessvc.CategoryRestaurants},
				Subcategories: []string{"fine_dining", "casual_dining"},
			},
			wantSQL: []string{"category = ANY", "subcategory = ANY", " AND "},
		},
		{
			name: "no subcategory filter omits the clause entirely",
			filter: activitiessvc.QueryFilter{
				Scope: activitiessvc.ScopeAnywhere,
			},
			notWantSQL: []string{"subcategory = ANY"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			query, args, err := buildQuery(tt.filter)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("buildQuery() error = nil, want error")
				}
				return
			}
			if err != nil {
				t.Fatalf("buildQuery() unexpected error: %v", err)
			}
			for _, want := range tt.wantSQL {
				if !strings.Contains(query, want) {
					t.Errorf("query = %q, want substring %q", query, want)
				}
			}
			for _, notWant := range tt.notWantSQL {
				if strings.Contains(query, notWant) {
					t.Errorf("query = %q, must not contain %q", query, notWant)
				}
			}
			if tt.wantArgs != nil {
				if len(args) != len(tt.wantArgs) {
					t.Fatalf("args = %v, want %v", args, tt.wantArgs)
				}
				for i, want := range tt.wantArgs {
					if args[i] != want {
						t.Errorf("args[%d] = %v, want %v", i, args[i], want)
					}
				}
			}
		})
	}
}

// TestBuildQuery_AlwaysFiltersToPublished proves T1's acceptance criteria
// directly: QueryActivities (the public app-facing RPC, backed by this
// query) must never surface a draft or pending activity, regardless of
// scope or any other combination of filters.
func TestBuildQuery_AlwaysFiltersToPublished(t *testing.T) {
	filters := []activitiessvc.QueryFilter{
		{Scope: activitiessvc.ScopeAnywhere},
		{Scope: activitiessvc.ScopeNearby, CurrentLocation: &activitiessvc.Point{Lat: 1, Lng: 2}, MaxDistanceKM: 10},
		{Scope: activitiessvc.ScopeAnywhere, Categories: []activitiessvc.Category{activitiessvc.CategorySport}, MinRating: 4},
		{Scope: activitiessvc.ScopeAnywhere, Cities: []activitiessvc.Point{{Lat: 41.9, Lng: 12.5}}, MaxDistanceKM: 50},
	}
	for _, f := range filters {
		query, _, err := buildQuery(f)
		if err != nil {
			t.Fatalf("buildQuery(%+v) unexpected error: %v", f, err)
		}
		if !strings.Contains(query, "status = 'published'") {
			t.Errorf("buildQuery(%+v) = %q, want the published-only filter present (drafts/pending must never reach the public query)", f, query)
		}
	}
}

func TestBuildListQuery(t *testing.T) {
	tests := []struct {
		name       string
		filter     activitiessvc.ListFilter
		wantSQL    []string
		notWantSQL []string
		wantArgs   []any
	}{
		{
			name:       "no filters yields no WHERE clause at all — the admin list is not published-only",
			filter:     activitiessvc.ListFilter{},
			notWantSQL: []string{"WHERE"},
		},
		{
			name:     "q filters with a case-insensitive substring match",
			filter:   activitiessvc.ListFilter{Q: "kayak"},
			wantSQL:  []string{"title ILIKE"},
			wantArgs: []any{"%kayak%"},
		},
		{
			name:     "category filters exactly",
			filter:   activitiessvc.ListFilter{Category: activitiessvc.CategorySport},
			wantSQL:  []string{"category ="},
			wantArgs: []any{"sport"},
		},
		{
			name:     "city filters exactly",
			filter:   activitiessvc.ListFilter{City: "Belgrade"},
			wantSQL:  []string{"city ="},
			wantArgs: []any{"Belgrade"},
		},
		{
			name:     "status filters exactly, and is not restricted to published like the public query",
			filter:   activitiessvc.ListFilter{Status: activitiessvc.StatusDraft},
			wantSQL:  []string{"status ="},
			wantArgs: []any{"draft"},
		},
		{
			name:     "combined filters AND together",
			filter:   activitiessvc.ListFilter{Category: activitiessvc.CategorySport, Status: activitiessvc.StatusPending},
			wantSQL:  []string{"category =", "status =", " AND "},
			wantArgs: []any{"sport", "pending"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			whereClause, args := buildListQuery(tt.filter)
			for _, want := range tt.wantSQL {
				if !strings.Contains(whereClause, want) {
					t.Errorf("buildListQuery() = %q, want substring %q", whereClause, want)
				}
			}
			for _, notWant := range tt.notWantSQL {
				if strings.Contains(whereClause, notWant) {
					t.Errorf("buildListQuery() = %q, must not contain %q", whereClause, notWant)
				}
			}
			if tt.wantArgs != nil {
				if len(args) != len(tt.wantArgs) {
					t.Fatalf("args = %v, want %v", args, tt.wantArgs)
				}
				for i, want := range tt.wantArgs {
					if args[i] != want {
						t.Errorf("args[%d] = %v, want %v", i, args[i], want)
					}
				}
			}
		})
	}
}

const (
	nearbyMapsURL = "https://maps.google.com/?cid=695253290703487434&g_mp=Cilnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaE5lYXJieRACGAQgAA"
	textMapsURL   = "https://maps.google.com/?cid=695253290703487434&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJjaFRleHQQAhgEIAA"
)

// canonicalSourceURLCases is shared with the integration-tagged
// TestCanonicalSourceURLMatchesMigration, which runs the same inputs through
// migration 0029's SQL expression in a real Postgres. The write path and the
// migration must agree on what "canonical" means for every one of these: a
// row the migration dedupes under one definition and the write path re-keys
// under another gets silently re-split by the next sync.
var canonicalSourceURLCases = []struct {
	name string
	in   string
	want string
}{
	{"g_mp stripped, cid preserved", nearbyMapsURL, "https://maps.google.com/?cid=695253290703487434"},
	{"g_mp first keeps the question mark", "https://maps.google.com/?g_mp=X&cid=7", "https://maps.google.com/?cid=7"},
	{"g_mp mid-query keeps sibling order", "https://x/?a=1&g_mp=X&b=2", "https://x/?a=1&b=2"},
	{"sole parameter drops the question mark", "https://x/?g_mp=X", "https://x/"},
	{"tripadvisor URL untouched", "https://www.tripadvisor.com/Restaurant_Review-g294472-d1.html", "https://www.tripadvisor.com/Restaurant_Review-g294472-d1.html"},
	{"no query string", "https://example.com/venue", "https://example.com/venue"},
	{"empty stays empty", "", ""},
	{"g_mp as a substring of another key is kept", "https://x/?not_g_mp=1", "https://x/?not_g_mp=1"},
	// Unreachable via Google (it emits one g_mp), but the SQL side needs the
	// 'g' flag to strip a repeat and Go strips every match for free — without
	// the flag the two definitions diverge here and nothing would catch it.
	{"repeated g_mp is fully stripped", "https://x/?a=1&g_mp=X&g_mp=Y", "https://x/?a=1"},
}

func TestCanonicalSourceURL(t *testing.T) {
	// The bug: one venue, two Places discovery calls, two source_urls -> two rows.
	if canonicalSourceURL(nearbyMapsURL) != canonicalSourceURL(textMapsURL) {
		t.Errorf("searchNearby and searchText URLs for the same venue must canonicalise equal:\n nearby=%q\n text=%q",
			canonicalSourceURL(nearbyMapsURL), canonicalSourceURL(textMapsURL))
	}

	for _, tt := range canonicalSourceURLCases {
		t.Run(tt.name, func(t *testing.T) {
			if got := canonicalSourceURL(tt.in); got != tt.want {
				t.Errorf("canonicalSourceURL(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
