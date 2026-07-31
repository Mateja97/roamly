package service

import (
	"context"
	"log/slog"
	"slices"
	"time"

	"activities-service/internal/places"
	"activities-service/internal/placesmap"

	"backend/shared/models/activitiessvc"
)

// googleSyncTTL is how long a synced (cell, category, subtype) is considered
// fresh. Matches tripadvisorSyncTTL — venues do not turn over faster for one
// provider than the other.
const googleSyncTTL = 14 * 24 * time.Hour

// googleSyncRadiusKM is the circle radius one discovery call sweeps. Matches
// NearbyRadiusKM so a Nearby-scope query syncs exactly the area it searches.
// The API ceiling is 50.
const googleSyncRadiusKM = 10

// maxGoogleRowsPerQuery caps how many discovery rows one Query call
// schedules. There are ~53 rows per cell; running them all on one query
// would cost ~$1.70 and hammer the API for a single search. At 8 per query a
// city converges over roughly seven searches, which is the price of not
// making the first user wait for a full ingest.
const maxGoogleRowsPerQuery = 8

// googleSyncJob is one unit of work: one discovery row at one anchor.
type googleSyncJob struct {
	anchor activitiessvc.Point
	row    placesmap.DiscoveryRow
}

// googleDueRows picks which discovery rows to sync for req, in priority
// order, capped at maxGoogleRowsPerQuery.
//
// Priority matters because the cap means most rows wait: a user who filtered
// to Wellness/Yoga should get yoga studios on their next search, not on their
// seventh. Order is (1) rows matching the request's category AND subtype
// filter, (2) rows matching its category filter, (3) everything else.
//
// fresh reports whether (cell, category, subtype) is within TTL; it is a
// callback rather than a repo call so this stays a pure function.
func googleDueRows(req Request, fresh func(cell, category, subtype string) bool) []googleSyncJob {
	var exact, category, rest []googleSyncJob

	for _, anchor := range syncAnchors(req) {
		cell := syncCellKey(anchor.Lat, anchor.Lng)
		for _, row := range placesmap.DiscoveryRows {
			if fresh(cell, string(row.Category), row.Subtype) {
				continue
			}
			job := googleSyncJob{anchor: anchor, row: row}
			catWanted := len(req.Categories) == 0 || slices.Contains(req.Categories, row.Category)
			subWanted := len(req.Subcategories) > 0 && slices.Contains(req.Subcategories, row.Subtype)

			switch {
			case catWanted && subWanted:
				exact = append(exact, job)
			case catWanted:
				category = append(category, job)
			default:
				rest = append(rest, job)
			}
		}
	}

	jobs := append(append(exact, category...), rest...)
	if len(jobs) > maxGoogleRowsPerQuery {
		jobs = jobs[:maxGoogleRowsPerQuery]
	}
	return jobs
}

// The quality floor is placesmap.PassesFloor, shared with the dry-run CLI so
// the numbers that tool reports are the numbers this one ingests.

// googleSyncTimeout bounds one background sync pass. Generous compared with
// the Tripadvisor sweep's 15s because nothing waits on this — Query has long
// since returned. It exists only so a wedged pass cannot leak a goroutine
// forever.
const googleSyncTimeout = 2 * time.Minute

// syncGoogleIfNeeded schedules a background type-driven discovery pass for
// req's anchors.
//
// Unlike the Tripadvisor sync, this runs detached: Query returns immediately
// and results land for the next search. Per-subtype granularity means one
// query can only ever fetch maxGoogleRowsPerQuery of ~53 rows, so blocking a
// search for seconds to deliver a fraction of a city is the worst of both
// options — and photo resolution (below) would blow any in-request budget
// outright.
//
// googleDueRows itself — and every SyncedAt lookup it makes, up to ~53 per
// anchor — runs inside the goroutine, not here. Only the "is a Places client
// even configured" check stays on the caller's goroutine, so a server with
// none spawns nothing; everything that touches the repo happens off the
// request path entirely, matching the "background" contract this function
// promises.
//
// Never fails Query: a sync problem at any step is logged and leaves the DB
// as-is, exactly like syncTripadvisorIfNeeded.
func (a *Activities) syncGoogleIfNeeded(ctx context.Context, req Request) {
	if a.places == nil {
		return
	}

	a.googleSync.Add(1)
	go func() {
		defer a.googleSync.Done()
		// Detached from the request context on purpose: the HTTP/gRPC
		// request is already finishing, and inheriting its cancellation
		// would abort every pass the moment Query returns.
		syncCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), googleSyncTimeout)
		defer cancel()

		jobs := googleDueRows(req, func(cell, category, subtype string) bool {
			syncedAt, ok, err := a.repo.SyncedAt(syncCtx, ProviderGoogle, cell, category, subtype)
			if err != nil {
				slog.Warn("google synced-at lookup failed", "cell", cell, "category", category, "subtype", subtype, "error", err)
				return false
			}
			return ok && time.Since(syncedAt) < googleSyncTTL
		})
		for _, job := range jobs {
			a.syncGoogleRow(syncCtx, job)
		}
	}()
}

// syncGoogleRow runs one discovery row at one anchor: a single searchNearby,
// then an Upsert per surviving place.
//
// MarkSynced is called only when the search call itself succeeded AND at
// least one place survived to a successful Upsert (or the search itself
// legitimately found nothing at all). A row whose search succeeded but whose
// every Upsert then failed is left unmarked too — marking it would freeze
// the cell at zero ingested rows for the whole TTL, the exact Belgrade
// failure mode (2 restaurants for 14 days) the Tripadvisor sweep's own
// MarkSynced gate exists to avoid. A single Upsert failure is logged and
// skipped without abandoning the rest of the row.
func (a *Activities) syncGoogleRow(ctx context.Context, job googleSyncJob) {
	var found []placesmap.Place
	var err error
	if len(job.row.Types) > 0 {
		found, err = a.places.SearchNearby(ctx, places.NearbyRequest{
			Lat: job.anchor.Lat, Lng: job.anchor.Lng,
			RadiusM:       googleSyncRadiusKM * 1000,
			IncludedTypes: job.row.Types,
			MaxResults:    20,
		}, places.NearbyFieldMask)
	} else {
		// The ~5 subtypes Table A cannot express. Area-bounded so a phrase
		// like "escape room" can't pull in results from the next country.
		found, err = a.places.SearchTextInArea(ctx, job.row.TextQuery,
			job.anchor.Lat, job.anchor.Lng, googleSyncRadiusKM, places.NearbyFieldMask)
	}
	if err != nil {
		slog.Warn("google discovery row failed",
			"category", job.row.Category, "subtype", job.row.Subtype, "error", err)
		return
	}

	kept := 0
	for _, p := range found {
		if !placesmap.PassesFloor(p) {
			continue
		}
		if _, err := a.repo.Upsert(ctx, toIngest(job.row, p)); err != nil {
			slog.Warn("google sync upsert failed", "place_id", p.ID, "error", err)
			continue
		}
		kept++
	}
	if kept == 0 && len(found) > 0 {
		slog.Warn("google discovery row found places but every upsert failed; leaving unmarked to retry",
			"category", job.row.Category, "subtype", job.row.Subtype, "found", len(found))
		return
	}

	cell := syncCellKey(job.anchor.Lat, job.anchor.Lng)
	if err := a.repo.MarkSynced(ctx, ProviderGoogle, cell, string(job.row.Category), job.row.Subtype); err != nil {
		slog.Warn("google mark-synced failed", "cell", cell, "category", job.row.Category, "subtype", job.row.Subtype, "error", err)
		return
	}
	slog.Info("google discovery row synced",
		"cell", cell, "category", job.row.Category, "subtype", job.row.Subtype,
		"found", len(found), "kept", kept)
}

// toIngest maps one discovered place onto the ingest shape. Category always
// comes from the discovery row. Subcategory is arbitrated (see subtypeFor).
// City/Country come from the place's own address components
// (placesmap.CityCountry) — both are storable under Places Terms §14.3
// (only hours/price/venue-type are not) and City in particular is load-
// bearing: BuildLiveDetails' opening-hours timezone lookup keys off it, and
// Upsert's ON CONFLICT does "city = EXCLUDED.city", so leaving it blank here
// would blank an existing legacy row's city on rediscovery.
//
// Details is deliberately empty — Places Terms §14.3 permits caching only
// place_id and lat/lng, so hours, price and venue type are fetched live on
// detail view instead (see placesmap.BuildLiveDetails).
func toIngest(row placesmap.DiscoveryRow, p placesmap.Place) activitiessvc.IngestActivity {
	city, country := placesmap.CityCountry(p.AddressComponents)
	return activitiessvc.IngestActivity{
		Title:       p.DisplayName.Text,
		Category:    row.Category,
		Subcategory: subtypeFor(row, p),
		Lat:         p.Location.Latitude,
		Lng:         p.Location.Longitude,
		City:        city,
		Country:     country,
		Address:     p.FormattedAddress,
		Rating:      p.Rating,
		Status:      activitiessvc.StatusPublished,
		Source:      "google_places",
		SourceURL:   p.GoogleMapsURI,
		ExternalID:  p.ID,
	}
}

// subtypeFor decides a discovered place's subtype, preferring what the place
// says about itself over which row happened to find it.
//
// Google types overlap at the PLACE level even though every type STRING sits
// on exactly one discovery row: a venue typed both "historical_place" and
// "monument" is returned by the historical_site row AND the monument_landmark
// row. Both upsert the same (source_url, category), so taking row.Subtype
// unconditionally would make the stored subtype last-writer-wins, decided by
// DiscoveryRows ordering. The Belgrade dry run measured this at 14% of
// results (125 of 868) — 19 of 20 monuments were claimed by historical_site
// purely because it sorts earlier in the table.
//
// placesmap.Subtype resolves from the place's own primaryType first, so every
// row that finds a given place computes the same answer: deterministic and
// order-independent. The row's own subtype is the fallback for places whose
// primaryType maps to nothing — the row is still what makes an unmappable
// place land in the right bucket.
func subtypeFor(row placesmap.DiscoveryRow, p placesmap.Place) string {
	if sub := placesmap.Subtype(row.Category, p.PrimaryType, p.Types); sub != "" {
		return sub
	}
	return row.Subtype
}
