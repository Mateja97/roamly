// Package repository is the data-access layer: it is the only layer that
// speaks SQL. QueryActivities is a bulk read with no not-found/conflict
// concept (an empty result is a valid, non-error answer), so there are no
// sentinel errors to translate here — see GO_STANDARDS.md "Errors".
package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"backend/shared/models/activitiessvc"
)

type Activities struct {
	db *pgxpool.Pool
}

func New(db *pgxpool.Pool) *Activities {
	return &Activities{db: db}
}

// buildQuery turns a validated QueryFilter into a parameterized SQL query.
// Pure function (no I/O) so it's unit-testable without a database.
func buildQuery(filter activitiessvc.QueryFilter) (string, []any, error) {
	var where []string
	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}

	distanceExpr := "0"
	var orderBy string

	switch filter.Scope {
	case activitiessvc.ScopeNearby:
		if filter.CurrentLocation == nil {
			return "", nil, fmt.Errorf("scope %s requires a reference location", filter.Scope)
		}
		distanceExpr = pointDistanceFilter(&where, arg, filter.CurrentLocation, filter.MaxDistanceKM)
		orderBy = "ORDER BY distance_km ASC"
	case activitiessvc.ScopeAnywhere:
		switch {
		case len(filter.Cities) > 0:
			// Cities take priority over current_location: a city-anchored
			// search is independent of the user's own location.
			distanceExpr = citiesDistanceFilter(&where, arg, filter.Cities, filter.MaxDistanceKM)
			orderBy = "ORDER BY distance_km ASC"
		case filter.CurrentLocation != nil:
			distanceExpr = pointDistanceFilter(&where, arg, filter.CurrentLocation, filter.MaxDistanceKM)
			orderBy = "ORDER BY distance_km ASC"
		default:
			orderBy = "ORDER BY title ASC" // no reference point: still deterministic
		}
	default:
		return "", nil, fmt.Errorf("unknown scope %q", filter.Scope)
	}

	if len(filter.Categories) > 0 {
		cats := make([]string, len(filter.Categories))
		for i, c := range filter.Categories {
			cats[i] = string(c)
		}
		where = append(where, fmt.Sprintf("category = ANY(%s)", arg(cats)))
	}
	if filter.MinRating > 0 {
		where = append(where, fmt.Sprintf("rating >= %s", arg(filter.MinRating)))
	}

	whereClause := "TRUE" // ponytail: ScopeAnywhere with no reference point and no
	// other filters has no WHERE condition at all; TRUE is the standard
	// always-true placeholder rather than a special-cased query template.
	if len(where) > 0 {
		whereClause = strings.Join(where, " AND ")
	}

	query := fmt.Sprintf(
		`SELECT id, title, description, category, ST_Y(location::geometry), ST_X(location::geometry),
			country, rating, photos, tags, %s AS distance_km
		FROM activities
		WHERE %s
		%s`,
		distanceExpr, whereClause, orderBy,
	)
	return query, args, nil
}

// pointDistanceFilter anchors the query at loc: it appends an ST_DWithin
// radius clause to where when maxKM is a positive limit (0 = no cap, e.g.
// "truly anywhere"), and always returns the ST_Distance expression used for
// the distance_km output column and closest-first ordering.
func pointDistanceFilter(where *[]string, arg func(any) string, loc *activitiessvc.Point, maxKM float64) string {
	lngArg := arg(loc.Lng)
	latArg := arg(loc.Lat)
	point := fmt.Sprintf("ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography", lngArg, latArg)
	if maxKM > 0 {
		radiusArg := arg(maxKM * 1000) // meters
		*where = append(*where, fmt.Sprintf("ST_DWithin(location, %s, %s)", point, radiusArg))
	}
	return fmt.Sprintf("ST_Distance(location, %s) / 1000.0", point)
}

// citiesDistanceFilter anchors the query on the union of cities: it appends
// an OR'd ST_DWithin clause per city when maxKM is a positive limit, and
// always returns a LEAST() expression over each city's ST_Distance for the
// distance_km output column (the minimum distance to any selected city) and
// closest-first ordering.
func citiesDistanceFilter(where *[]string, arg func(any) string, cities []activitiessvc.Point, maxKM float64) string {
	distances := make([]string, len(cities))
	radii := make([]string, len(cities))
	for i, c := range cities {
		lngArg := arg(c.Lng)
		latArg := arg(c.Lat)
		point := fmt.Sprintf("ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography", lngArg, latArg)
		distances[i] = fmt.Sprintf("ST_Distance(location, %s) / 1000.0", point)
		if maxKM > 0 {
			radiusArg := arg(maxKM * 1000) // meters
			radii[i] = fmt.Sprintf("ST_DWithin(location, %s, %s)", point, radiusArg)
		}
	}
	if maxKM > 0 {
		*where = append(*where, "("+strings.Join(radii, " OR ")+")")
	}
	return fmt.Sprintf("LEAST(%s)", strings.Join(distances, ", "))
}

// SuggestCities returns catalog cities whose name starts with prefix
// (case-insensitive), each with the centroid of its activities. prefix is
// assumed non-empty (the service layer short-circuits an empty query); %
// and _ are escaped so they match literally rather than as SQL LIKE
// wildcards.
func (r *Activities) SuggestCities(ctx context.Context, prefix string) ([]activitiessvc.CitySuggestion, error) {
	escaped := likeEscaper.Replace(prefix)
	rows, err := r.db.Query(ctx, `
		SELECT city, country, AVG(ST_Y(location::geometry)), AVG(ST_X(location::geometry))
		FROM activities
		WHERE city ILIKE $1 || '%' ESCAPE '\'
		GROUP BY city, country
		ORDER BY city ASC
		LIMIT 10`, escaped)
	if err != nil {
		return nil, fmt.Errorf("querying city suggestions: %w", err)
	}
	defer rows.Close()

	var out []activitiessvc.CitySuggestion
	for rows.Next() {
		var s activitiessvc.CitySuggestion
		if err := rows.Scan(&s.City, &s.Country, &s.Centroid.Lat, &s.Centroid.Lng); err != nil {
			return nil, fmt.Errorf("scanning city suggestion row: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating city suggestion rows: %w", err)
	}
	return out, nil
}

var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// Query runs the scoped, filtered activity search.
func (r *Activities) Query(ctx context.Context, filter activitiessvc.QueryFilter) ([]activitiessvc.Activity, error) {
	query, args, err := buildQuery(filter)
	if err != nil {
		return nil, fmt.Errorf("building query: %w", err)
	}

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("querying activities: %w", err)
	}
	defer rows.Close()

	var out []activitiessvc.Activity
	for rows.Next() {
		var a activitiessvc.Activity
		if err := rows.Scan(
			&a.ID, &a.Title, &a.Description, &a.Category,
			&a.Location.Lat, &a.Location.Lng,
			&a.Country, &a.Rating,
			&a.Photos, &a.Tags, &a.DistanceKM,
		); err != nil {
			return nil, fmt.Errorf("scanning activity row: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating activity rows: %w", err)
	}
	return out, nil
}
