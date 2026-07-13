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
	case activitiessvc.ScopeHome, activitiessvc.ScopeNearby:
		loc := filter.HomeLocation
		if filter.Scope == activitiessvc.ScopeNearby {
			loc = filter.CurrentLocation
		}
		if loc == nil {
			return "", nil, fmt.Errorf("scope %s requires a reference location", filter.Scope)
		}
		lngArg := arg(loc.Lng)
		latArg := arg(loc.Lat)
		point := fmt.Sprintf("ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography", lngArg, latArg)
		radiusArg := arg(filter.MaxDistanceKM * 1000) // meters
		where = append(where, fmt.Sprintf("ST_DWithin(location, %s, %s)", point, radiusArg))
		distanceExpr = fmt.Sprintf("ST_Distance(location, %s) / 1000.0", point)
		orderBy = "ORDER BY distance_km ASC"
	case activitiessvc.ScopeMyCountry:
		where = append(where, fmt.Sprintf("country <> %s", arg(filter.HomeCountry)))
		if filter.Sort == activitiessvc.SortTopRated {
			// The rating-sort MVP: highest rating first, deterministic
			// tie-break by title so equal-rated activities still return in
			// a stable order across requests/pages.
			orderBy = "ORDER BY rating DESC, title ASC"
		} else {
			orderBy = "ORDER BY title ASC" // still deterministic without an explicit sort request
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

	query := fmt.Sprintf(
		`SELECT id, title, description, category, ST_Y(location::geometry), ST_X(location::geometry),
			country, rating, image_refs, tags, %s AS distance_km
		FROM activities
		WHERE %s
		%s`,
		distanceExpr, strings.Join(where, " AND "), orderBy,
	)
	return query, args, nil
}

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
			&a.ImageRefs, &a.Tags, &a.DistanceKM,
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
