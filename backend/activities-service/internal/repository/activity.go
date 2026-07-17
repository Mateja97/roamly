// Package repository is the data-access layer: it is the only layer that
// speaks SQL. QueryActivities is a bulk read with no not-found/conflict
// concept (an empty result is a valid, non-error answer), so there are no
// sentinel errors to translate here — see GO_STANDARDS.md "Errors".
package repository

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	sharederrors "backend/shared/errors"
	"backend/shared/models/activitiessvc"
)

type Activities struct {
	db *pgxpool.Pool
}

func New(db *pgxpool.Pool) *Activities {
	return &Activities{db: db}
}

// argBinder returns a closure that appends v to *args and returns its
// positional placeholder ($1, $2, ...) — buildQuery, buildListQuery, and
// Update each build a parameterized SQL statement incrementally this way.
func argBinder(args *[]any) func(any) string {
	return func(v any) string {
		*args = append(*args, v)
		return fmt.Sprintf("$%d", len(*args))
	}
}

// buildQuery turns a validated QueryFilter into a parameterized SQL query.
// Pure function (no I/O) so it's unit-testable without a database.
func buildQuery(filter activitiessvc.QueryFilter) (string, []any, error) {
	// Every query is scoped to published activities only (T1): drafts and
	// pending rows exist for the admin surface (T2) but must never reach
	// QueryActivities, the public app-facing RPC. Hardcoded rather than a
	// caller-supplied filter, so no combination of scope/filters can leak
	// one; a literal (not a bound arg) since it's a fixed Go constant, not
	// user input.
	where := []string{fmt.Sprintf("status = '%s'", activitiessvc.StatusPublished)}
	var args []any
	arg := argBinder(&args)

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

	// where always has at least the status filter above, so this is never
	// empty — no "always true" placeholder needed.
	whereClause := strings.Join(where, " AND ")

	query := fmt.Sprintf(
		`SELECT id, title, description, category, ST_Y(location::geometry), ST_X(location::geometry),
			country, rating, photos, tags, details,
			COALESCE(city, '') AS city, COALESCE(address, '') AS address, status,
			%s AS distance_km
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
	// Published-only (T1), same invariant as Query: this is the other
	// public-app-facing reader of the activities table (GET /cities/suggest),
	// so a draft row must not surface a city or skew its centroid AVG.
	escaped := likeEscaper.Replace(prefix)
	rows, err := r.db.Query(ctx, `
		SELECT city, country, AVG(ST_Y(location::geometry)), AVG(ST_X(location::geometry))
		FROM activities
		WHERE city ILIKE $1 || '%' ESCAPE '\' AND status = '`+string(activitiessvc.StatusPublished)+`'
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
			&a.Photos, &a.Tags, &a.Details,
			&a.City, &a.Address, &a.Status, &a.DistanceKM,
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

// adminColumns is the column list every admin (T2) read/write shares: every
// lifecycle state, no distance_km (meaningless outside a scoped/anchored
// Query). Reused by GetByID, Create, Update, and List's page SELECT so the
// column order used by scanAdminActivity never drifts from what's selected.
const adminColumns = `id, title, description, category, ST_Y(location::geometry), ST_X(location::geometry),
	country, rating, photos, tags, details,
	COALESCE(city, '') AS city, COALESCE(address, '') AS address, status`

func scanAdminActivity(row pgx.Row) (activitiessvc.Activity, error) {
	var a activitiessvc.Activity
	err := row.Scan(
		&a.ID, &a.Title, &a.Description, &a.Category,
		&a.Location.Lat, &a.Location.Lng,
		&a.Country, &a.Rating,
		&a.Photos, &a.Tags, &a.Details,
		&a.City, &a.Address, &a.Status,
	)
	return a, err
}

// buildListQuery turns a validated ListFilter into a parameterized WHERE
// clause (possibly empty) plus its bound args. Pure function (no I/O), same
// shape as buildQuery, so it's unit-testable without a database.
func buildListQuery(filter activitiessvc.ListFilter) (string, []any) {
	var where []string
	var args []any
	arg := argBinder(&args)

	if filter.Q != "" {
		where = append(where, fmt.Sprintf("title ILIKE %s ESCAPE '\\'", arg("%"+likeEscaper.Replace(filter.Q)+"%")))
	}
	if filter.Category != "" {
		where = append(where, fmt.Sprintf("category = %s", arg(string(filter.Category))))
	}
	if filter.City != "" {
		where = append(where, fmt.Sprintf("city = %s", arg(filter.City)))
	}
	if filter.Status != "" {
		where = append(where, fmt.Sprintf("status = %s", arg(string(filter.Status))))
	}

	whereClause := ""
	if len(where) > 0 {
		whereClause = "WHERE " + strings.Join(where, " AND ")
	}
	return whereClause, args
}

// List returns one page of the admin activity list matching filter, the
// total matching that filter (for pagination), and catalog-wide Stats
// (unaffected by filter). Three simple queries (filtered COUNT, the page
// SELECT, an unfiltered GROUP BY status) rather than one query with window
// functions — this is a low-traffic internal admin surface, and three plain
// queries are far easier to read and test than one CTE.
func (r *Activities) List(ctx context.Context, filter activitiessvc.ListFilter) (activitiessvc.ListResult, error) {
	whereClause, whereArgs := buildListQuery(filter)

	var total int
	if err := r.db.QueryRow(ctx, "SELECT count(*) FROM activities "+whereClause, whereArgs...).Scan(&total); err != nil {
		return activitiessvc.ListResult{}, fmt.Errorf("counting activities: %w", err)
	}

	limitArg := fmt.Sprintf("$%d", len(whereArgs)+1)
	offsetArg := fmt.Sprintf("$%d", len(whereArgs)+2)
	listArgs := append(append([]any{}, whereArgs...), filter.Limit, filter.Offset)
	query := fmt.Sprintf(`SELECT %s FROM activities %s ORDER BY title ASC, id ASC LIMIT %s OFFSET %s`,
		adminColumns, whereClause, limitArg, offsetArg)

	rows, err := r.db.Query(ctx, query, listArgs...)
	if err != nil {
		return activitiessvc.ListResult{}, fmt.Errorf("listing activities: %w", err)
	}
	defer rows.Close()

	var activities []activitiessvc.Activity
	for rows.Next() {
		a, err := scanAdminActivity(rows)
		if err != nil {
			return activitiessvc.ListResult{}, fmt.Errorf("scanning activity row: %w", err)
		}
		activities = append(activities, a)
	}
	if err := rows.Err(); err != nil {
		return activitiessvc.ListResult{}, fmt.Errorf("iterating activity rows: %w", err)
	}

	stats, err := r.stats(ctx)
	if err != nil {
		return activitiessvc.ListResult{}, fmt.Errorf("computing stats: %w", err)
	}

	return activitiessvc.ListResult{Activities: activities, Total: total, Stats: stats}, nil
}

// stats counts the whole catalog by status, ignoring any filter — one
// unfiltered GROUP BY, not 4 separate COUNT(*) queries.
func (r *Activities) stats(ctx context.Context) (activitiessvc.Stats, error) {
	rows, err := r.db.Query(ctx, "SELECT status, count(*) FROM activities GROUP BY status")
	if err != nil {
		return activitiessvc.Stats{}, fmt.Errorf("querying status counts: %w", err)
	}
	defer rows.Close()

	var stats activitiessvc.Stats
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return activitiessvc.Stats{}, fmt.Errorf("scanning status count: %w", err)
		}
		stats.Total += count
		switch activitiessvc.Status(status) {
		case activitiessvc.StatusPublished:
			stats.Published = count
		case activitiessvc.StatusDraft:
			stats.Draft = count
		case activitiessvc.StatusPending:
			stats.Pending = count
		}
	}
	if err := rows.Err(); err != nil {
		return activitiessvc.Stats{}, fmt.Errorf("iterating status counts: %w", err)
	}
	return stats, nil
}

// AdminDistinctCities returns every distinct, non-empty city across all
// statuses (T2's admin surface has no published-only restriction, unlike
// SuggestCities) — backs the admin panel's city filter dropdown.
func (r *Activities) AdminDistinctCities(ctx context.Context) ([]string, error) {
	rows, err := r.db.Query(ctx, `SELECT DISTINCT city FROM activities WHERE city <> '' ORDER BY city ASC`)
	if err != nil {
		return nil, fmt.Errorf("querying distinct cities: %w", err)
	}
	defer rows.Close()

	cities := []string{}
	for rows.Next() {
		var city string
		if err := rows.Scan(&city); err != nil {
			return nil, fmt.Errorf("scanning city row: %w", err)
		}
		cities = append(cities, city)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating city rows: %w", err)
	}
	return cities, nil
}

// GetByID returns a single activity regardless of lifecycle state (T2's
// admin surface has no published-only restriction, unlike Query).
// sharederrors.ErrNotFound when the id doesn't exist.
func (r *Activities) GetByID(ctx context.Context, id string) (activitiessvc.Activity, error) {
	a, err := scanAdminActivity(r.db.QueryRow(ctx, "SELECT "+adminColumns+" FROM activities WHERE id = $1", id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return activitiessvc.Activity{}, sharederrors.ErrNotFound
		}
		return activitiessvc.Activity{}, fmt.Errorf("getting activity %s: %w", id, err)
	}
	return a, nil
}

// nonNilPhotos returns a non-nil (possibly empty) slice: pgx's JSONB codec
// sends a nil slice as SQL NULL, which the photos column's NOT NULL
// constraint rejects — an absent photos list means "no photos yet" (an
// empty JSON array), never NULL.
func nonNilPhotos(photos []activitiessvc.Photo) []activitiessvc.Photo {
	if photos == nil {
		return []activitiessvc.Photo{}
	}
	return photos
}

// nonEmptyDetailsBytes is the []byte the details column's bind arg always
// uses: pgx's JSONB codec sends a nil/empty []byte as SQL NULL, which the
// NOT NULL constraint rejects. The service layer already normalizes empty
// details to "{}" before it ever reaches here (see service.normalizeDetails)
// — this is defense in depth for repository, tested independently of the
// service, not a second copy of that validation.
func nonEmptyDetailsBytes(details []byte) []byte {
	if len(bytes.TrimSpace(details)) == 0 {
		return []byte("{}")
	}
	return details
}

// Create inserts a new activity (T2). location/country/rating aren't part
// of the admin API surface yet (see activitiessvc.NewActivity's doc), so
// every new row gets an honest "not yet set" sentinel — Null Island
// (0,0)/""/0 — rather than a fabricated real value; a future geocoding
// feature is what actually sets these.
func (r *Activities) Create(ctx context.Context, in activitiessvc.NewActivity) (activitiessvc.Activity, error) {
	a, err := scanAdminActivity(r.db.QueryRow(ctx, `
		INSERT INTO activities (title, description, category, location, country, rating, city, address, status, details, photos)
		VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography, '', 0, $4, $5, $6, $7, $8)
		RETURNING `+adminColumns,
		in.Title, in.Description, string(in.Category),
		in.City, in.Address, string(in.Status), nonEmptyDetailsBytes(in.Details), nonNilPhotos(in.Photos),
	))
	if err != nil {
		return activitiessvc.Activity{}, fmt.Errorf("creating activity: %w", err)
	}
	return a, nil
}

// Update applies a partial update (T2): only patch's non-nil fields appear
// in the SQL SET list, same arg-closure pattern as buildQuery. A patch with
// every field nil is a no-op read (still 404s via GetByID if id doesn't
// exist), rather than running an empty/invalid `SET` clause.
func (r *Activities) Update(ctx context.Context, id string, patch activitiessvc.UpdatePatch) (activitiessvc.Activity, error) {
	var sets []string
	var args []any
	arg := argBinder(&args)

	if patch.Title != nil {
		sets = append(sets, "title = "+arg(*patch.Title))
	}
	if patch.Description != nil {
		sets = append(sets, "description = "+arg(*patch.Description))
	}
	if patch.Category != nil {
		sets = append(sets, "category = "+arg(string(*patch.Category)))
	}
	if patch.City != nil {
		sets = append(sets, "city = "+arg(*patch.City))
	}
	if patch.Address != nil {
		sets = append(sets, "address = "+arg(*patch.Address))
	}
	if patch.Status != nil {
		sets = append(sets, "status = "+arg(string(*patch.Status)))
	}
	if patch.Details != nil {
		sets = append(sets, "details = "+arg(nonEmptyDetailsBytes(*patch.Details)))
	}
	if patch.Photos != nil {
		sets = append(sets, "photos = "+arg(nonNilPhotos(*patch.Photos)))
	}

	if len(sets) == 0 {
		return r.GetByID(ctx, id)
	}

	idArg := arg(id)
	query := fmt.Sprintf("UPDATE activities SET %s WHERE id = %s RETURNING %s", strings.Join(sets, ", "), idArg, adminColumns)

	a, err := scanAdminActivity(r.db.QueryRow(ctx, query, args...))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return activitiessvc.Activity{}, sharederrors.ErrNotFound
		}
		return activitiessvc.Activity{}, fmt.Errorf("updating activity %s: %w", id, err)
	}
	return a, nil
}
