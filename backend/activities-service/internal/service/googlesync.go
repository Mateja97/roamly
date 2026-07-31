package service

import (
	"slices"
	"time"

	"activities-service/internal/placesmap"

	"backend/shared/models/activitiessvc"
)

// googleSyncTTL is how long a synced (cell, category, subtype) is considered
// fresh. Matches tripadvisorSyncTTL — venues do not turn over faster for one
// provider than the other.
//
//nolint:unused // consumed by the sweep that calls googleDueRows against the repo (next task); part of this task's interface contract.
const googleSyncTTL = 14 * 24 * time.Hour

// googleSyncRadiusKM is the circle radius one discovery call sweeps. Matches
// NearbyRadiusKM so a Nearby-scope query syncs exactly the area it searches.
// The API ceiling is 50.
//
//nolint:unused // consumed by the live Google search call (next task); part of this task's interface contract.
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
