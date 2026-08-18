package service

import (
	"context"
	"log/slog"
	"slices"
	"time"

	"activities-service/internal/namemap"
	"activities-service/internal/places"
	"activities-service/internal/placesmap"

	"backend/shared/models/activitiessvc"
)

// defaultGoogleSyncTTL is how long a synced (cell, category, subtype) is
// considered fresh, absent an explicit GOOGLE_SYNC_TTL_DAYS override (T4,
// places-api-cost-reduction): venue turnover in the Google-sourced
// categories doesn't need a fortnightly refresh, so 30 days halves the
// sweep rate versus the previous fixed 14. Activities.googleSyncTTL is the
// field actually read at sync time — see New/WithGoogleSyncTTL.
const defaultGoogleSyncTTL = 30 * 24 * time.Hour

// googleMaxSyncRadiusKM is Places' documented radius ceiling for a single
// searchNearby/searchText call (D2, D4) — the widest circle one sync call
// can ever cover, regardless of how large the request's own MaxDistanceKM
// is. 100km/200km/no-limit Anywhere requests all sync this same 50km circle;
// only the *query* still filters by the true requested distance against
// whatever data exists (real coverage past this ceiling needs multi-anchor
// tiling, deferred — see design doc D4).
const googleMaxSyncRadiusKM = 50

// googleSyncRadiusKM resolves req's actual sync radius (D2): Nearby always
// syncs its own fixed NearbyRadiusKM regardless of req.MaxDistanceKM, so a
// Nearby-scope query syncs exactly the area it searches. Anywhere syncs
// min(req.MaxDistanceKM, googleMaxSyncRadiusKM) km, or the ceiling itself
// when MaxDistanceKM is unset (the "Any" stop, which carries no numeric
// cap). Places pricing is per-call, not per-radius, so a larger radius
// parameter on the same single call this already makes is a correctness
// fix with no added API cost.
func googleSyncRadiusKM(req Request) float64 {
	if req.Scope != activitiessvc.ScopeAnywhere {
		return NearbyRadiusKM
	}
	if req.MaxDistanceKM > 0 {
		return min(req.MaxDistanceKM, googleMaxSyncRadiusKM)
	}
	return googleMaxSyncRadiusKM
}

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

// cellLocation is a sync cell's resolved place name, applied to every venue
// the sweep ingests there — Google and (see resolveTripadvisorCity)
// Tripadvisor both use this same shape. Resolved once per cell (see
// places.Client.ReverseGeocodeCity): per-venue derivation from each place's
// own addressComponents fragmented one city into eight strings in a live
// Belgrade sweep (Beograd 225, Belgrade 80, Београд 4, …), because
// `locality` carries the local name and sometimes a sub-municipality. A
// zero-value cellLocation means resolution failed, came back empty, or no
// Places client is configured — toIngest then writes an empty city/country,
// which Upsert's ON CONFLICT COALESCE(NULLIF(...), ...) preserves against
// whatever is already stored rather than blanking it, so a genuinely new
// row is the only case that lands with no city at all.
type cellLocation struct {
	City    string
	Country string
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
			// Restaurants/Bars rows exist in DiscoveryRows for
			// classification only (placesmap.Subtype) — discovery stays
			// Tripadvisor-exclusive for them, so skip before they ever reach
			// a searchNearby call.
			if !slices.Contains(placesmap.GoogleCategories, row.Category) {
				continue
			}
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

// googleSyncConcurrency bounds how many sweeps run at once across the whole
// process. One sweep issues at most maxGoogleRowsPerQuery (8) searchNearby
// calls plus one geocode call per cell — 8 searchNearby + 1 geocode ≈ 9
// Google API calls per sweep (T5, places-api-cost-reduction: no per-result
// photo call at sync time any more, so a sweep costs 9 calls total, down
// from ~169 when each of a search's up-to-20 results also drew its own
// photo call).
// Left unbounded, a 100-request burst spawns 100 concurrent sweeps (~900
// calls, 100 live goroutines) with nothing shedding load, and doJSON's
// 429/5xx retry then multiplies quota pressure instead of backing off. 4
// keeps at most ~36 calls in flight at once while still letting several
// distinct cells make progress in parallel; raise it only alongside a real
// per-process Google API budget (see the "out of scope" note on
// pgxpool.MaxConns — same shape of problem, deliberately deferred).
const googleSyncConcurrency = 4

// googleSyncSem is a non-blocking semaphore: acquiring a slot is a buffered
// channel send with a default case, so a sweep that finds it full is
// dropped, not queued. Queueing would only move the pile-up from goroutines
// to a channel buffer; dropping actually sheds load. A dropped sweep leaves
// its rows unmarked, so a later query retries them — the same fallback a
// failed row already gets (see syncGoogleRow's doc).
var googleSyncSem = make(chan struct{}, googleSyncConcurrency)

// googleSyncCells is the set of sync cells with a Google sweep currently
// running. Without it, two concurrent queries against the same uncovered
// cell both see the same stale rows from SyncedAt and both sync them —
// doubling every search and upsert for that sweep. Cells are
// claimed synchronously in syncGoogleIfNeeded before its goroutine is
// spawned (so a second call for the same cell sees the claim immediately,
// not just once the first goroutine gets scheduled) and released via defer
// when the goroutine returns on every exit path, including panic.
//
// tripadvisorSyncCells (activity.go) is the same guard for the Tripadvisor
// sweep, its own instance of syncCellGate — a separate provider means a
// separate quota and a separate in-flight set, but the claim/release shape
// is identical, hence the shared type instead of a second copy of this
// mutex-and-map pair.
var googleSyncCells = &syncCellGate{inFlight: make(map[string]struct{})}

// syncGoogleIfNeeded schedules a background type-driven discovery pass for
// req's anchors — detached the same way syncTripadvisorIfNeeded's sweep is
// (see that function's doc): Query returns immediately and results land for
// the next search. Per-subtype granularity means one query can only ever
// fetch maxGoogleRowsPerQuery of ~53 rows, so blocking a search for seconds
// to deliver a fraction of a city is the worst of both options.
//
// googleDueRows itself — and every SyncedAt lookup it makes, up to ~53 per
// anchor — runs inside the goroutine, not here. Only the "is a Places client
// even configured" check, and the concurrency/in-flight gating below, stay
// on the caller's goroutine, so a server with no Places client spawns
// nothing; everything that touches the repo happens off the request path
// entirely, matching the "background" contract this function promises.
//
// Gating happens in this order: claim this request's cells (cheap, no I/O —
// see googleSyncCells), then acquire a concurrency slot. Either failing
// drops the sweep entirely rather than queueing it; a dropped sweep's rows
// stay stale and a later query retries them.
//
// Never fails Query: a sync problem at any step is logged and leaves the DB
// as-is, exactly like syncTripadvisorIfNeeded.
func (a *Activities) syncGoogleIfNeeded(ctx context.Context, req Request) {
	if a.places == nil {
		return
	}

	anchors := syncAnchors(req)
	if len(anchors) == 0 {
		return
	}
	cells := make([]string, 0, len(anchors))
	seen := make(map[string]struct{}, len(anchors))
	for _, anchor := range anchors {
		key := syncCellKey(anchor.Lat, anchor.Lng)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		cells = append(cells, key)
	}

	if !googleSyncCells.claim(cells) {
		return
	}
	select {
	case googleSyncSem <- struct{}{}:
	default:
		googleSyncCells.release(cells)
		return
	}

	a.googleSync.Add(1)
	go func() {
		defer a.googleSync.Done()
		defer googleSyncCells.release(cells)
		defer func() { <-googleSyncSem }()
		// Detached from the request context on purpose: the HTTP/gRPC
		// request is already finishing, and inheriting its cancellation
		// would abort every pass the moment Query returns.
		syncCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), googleSyncTimeout)
		defer cancel()

		// Resolved once for the whole sweep: every job below shares the same
		// request, so they all sync (and are judged fresh against) the same
		// radius — see googleSyncRadiusKM's own doc for Nearby vs Anywhere
		// resolution (D2).
		radiusKM := googleSyncRadiusKM(req)

		// One FreshSyncRows query per cell rather than one SyncedAt call per
		// (cell, category, subtype): googleDueRows' fresh callback runs for
		// every one of DiscoveryRows' ~53 rows per anchor, so the per-row
		// query this replaced cost ~53 round-trips per cell even in the
		// fully-fresh steady state, with no early exit once the 8-job budget
		// filled. fresh still stays a pure in-memory lookup — see
		// googleDueRows' own doc for why it takes a callback instead of a
		// repo handle.
		freshByCell := make(map[string]map[string]bool, len(cells))
		since := time.Now().Add(-a.googleSyncTTL)
		for _, cell := range cells {
			set, err := a.repo.FreshSyncRows(syncCtx, ProviderGoogle, cell, since, radiusKM)
			if err != nil {
				slog.Warn("google fresh-sync-rows lookup failed; treating cell as fully stale", "cell", cell, "error", err)
				continue
			}
			freshByCell[cell] = set
		}

		jobs := googleDueRows(req, func(cell, category, subtype string) bool {
			return freshByCell[cell][category+"|"+subtype]
		})

		// Resolve each distinct anchor's city once, before running its jobs —
		// not once per venue and not once per row.
		//
		// A geocode ERROR must drop that cell's jobs entirely rather than
		// proceed with an empty cellLocation: for a cell being swept for the
		// first time there is no already-stored row for Upsert's
		// COALESCE(NULLIF(...), ...) to protect, so an empty city/country
		// would actually be written — dropping new venues out of
		// SuggestCities' Anywhere picker and out of TimezoneForCountry's
		// lookup. Skipping the jobs here (never calling syncGoogleRow) is
		// what keeps them unmarked, same as a failed search row, so a later
		// query retries the cell instead of freezing it stale for
		// googleSyncTTL.
		//
		// ZERO_RESULTS is different: err == nil, city/country simply empty —
		// a genuinely unnamed location (mid-ocean, say). Its jobs still run
		// and still get marked normally, or an unnamed cell would re-search
		// forever (the unbounded-spend failure mode an earlier round fixed).
		cellLocations := make(map[string]cellLocation)
		erroredCells := make(map[string]bool)
		for _, job := range jobs {
			key := syncCellKey(job.anchor.Lat, job.anchor.Lng)
			if _, ok := cellLocations[key]; ok || erroredCells[key] {
				continue
			}
			city, country, err := a.places.ReverseGeocodeCity(syncCtx, job.anchor.Lat, job.anchor.Lng)
			if err != nil {
				slog.Warn("google reverse geocode failed; leaving cell unmarked to retry", "cell", key, "error", err)
				erroredCells[key] = true
				continue
			}
			cellLocations[key] = cellLocation{City: city, Country: country}
		}

		for _, job := range jobs {
			key := syncCellKey(job.anchor.Lat, job.anchor.Lng)
			if erroredCells[key] {
				continue
			}
			a.syncGoogleRow(syncCtx, job, cellLocations[key], radiusKM, nil)
		}
	}()
}

// placesCallTally counts Places API calls a batch run makes, split by SKU
// tier (places.PlaceholderSKUTier) — T7's "report calls made, per SKU tier" contract
// for every batch Places tool. nil-safe: syncGoogleIfNeeded's live
// per-request sync passes nil into syncGoogleRow and skips tallying
// entirely, since that path is already capped by maxGoogleRowsPerQuery and
// prints no report.
type placesCallTally struct {
	total  int
	byTier map[string]int
}

// record counts one Places call sent with fieldMask. Safe to call on a nil
// *placesCallTally (a no-op), so syncGoogleRow does not need its own
// tally==nil branch at every call site.
func (t *placesCallTally) record(fieldMask string) {
	if t == nil {
		return
	}
	if t.byTier == nil {
		t.byTier = map[string]int{}
	}
	t.byTier[places.PlaceholderSKUTier(fieldMask)]++
	t.total++
}

// PrewarmSummary reports one PrewarmGoogle run: how much of anchor's
// discovery-row table it covered before its call budget ran out (T7,
// places-api-cost-reduction) — "stop cleanly, report calls made and input
// coverage as partial" for every batch Places tool.
type PrewarmSummary struct {
	RowsTotal, RowsCovered, CallsMade int
	CallsByTier                       map[string]int
	// Partial is true when maxCalls was reached before every discovery row
	// at anchor got a turn — the run stopped short of full coverage.
	Partial bool
}

// PrewarmGoogle runs discovery rows at anchor synchronously, ignoring the
// freshness TTL and maxGoogleRowsPerQuery, until either every row has run or
// maxCalls Places calls have been made — whichever comes first. Seed/build-
// time only (cmd/scrapecity) — the request path uses syncGoogleIfNeeded,
// which is budgeted and detached.
//
// maxCalls must be > 0; cmd/scrapecity is the one place that validates this
// (T7's "refuses to start without one" contract lives at the CLI flag, not
// here) — PrewarmGoogle itself just treats maxCalls <= 0 as "stop
// immediately, zero rows covered" rather than looping forever.
//
// The budget is checked once per row, before that row's calls are made, not
// mid-row: syncGoogleRow's own search call is not individually preemptible,
// so a run can overshoot maxCalls by at most one row's worth of calls (its
// single search call — T5, places-api-cost-reduction removed the
// per-venue ResolvePhotos call this overshoot used to also account for).
// Bounded overshoot, not unlimited spend — the row that pushes the tally
// over budget is the last one this run makes.
//
// It resolves anchor's city once, the same way syncGoogleIfNeeded resolves
// it once per sync cell, then runs each row through syncGoogleRow — the same
// function the lazy sync uses — rather than reimplementing discovery.
func (a *Activities) PrewarmGoogle(ctx context.Context, anchor activitiessvc.Point, maxCalls int) PrewarmSummary {
	if a.places == nil {
		slog.Error("prewarm needs a Places client")
		return PrewarmSummary{}
	}
	var cell cellLocation
	city, country, err := a.places.ReverseGeocodeCity(ctx, anchor.Lat, anchor.Lng)
	if err != nil {
		// Unlike syncGoogleIfNeeded, this manual seed tool proceeds anyway
		// with an empty city/country rather than skipping the anchor — an
		// operator running this by hand can see the warning and rerun it,
		// so there's no unattended-14-day-freeze risk to guard against here.
		slog.Warn("google reverse geocode failed; seeding with empty city/country", "error", err)
	} else {
		cell = cellLocation{City: city, Country: country}
	}

	rows := make([]placesmap.DiscoveryRow, 0, len(placesmap.DiscoveryRows))
	for _, row := range placesmap.DiscoveryRows {
		// Same gate as googleDueRows: Restaurants/Bars rows classify
		// Tripadvisor venues but are never discovered from Google.
		if slices.Contains(placesmap.GoogleCategories, row.Category) {
			rows = append(rows, row)
		}
	}

	summary := PrewarmSummary{RowsTotal: len(rows)}
	tally := &placesCallTally{}
	for _, row := range rows {
		if tally.total >= maxCalls {
			summary.Partial = true
			slog.Warn("prewarm call budget reached; stopping short of full coverage",
				"rows_covered", summary.RowsCovered, "rows_total", summary.RowsTotal, "calls_made", tally.total, "max_calls", maxCalls)
			break
		}
		// NearbyRadiusKM, unchanged from before this radius became
		// per-request (D2): this manual seed tool has no Request/scope to
		// resolve a wider radius from, and widening it is outside this
		// task's scope — a seed run stays exactly as comprehensive as it
		// was.
		a.syncGoogleRow(ctx, googleSyncJob{anchor: anchor, row: row}, cell, NearbyRadiusKM, tally)
		summary.RowsCovered++
	}
	summary.CallsMade = tally.total
	summary.CallsByTier = tally.byTier
	return summary
}

// syncGoogleRow runs one discovery row at one anchor: a single searchNearby,
// then an Upsert per surviving place — except a place arbitrated away by
// venueWrongCategory (below), which is neither ingested nor counted as
// eligible for this row.
//
// MarkSynced is called only when the search call itself succeeded AND every
// place that should have been ingested (survived placesmap.PassesFloor AND
// venueWrongCategory) was actually ingested — or the row genuinely had
// nothing eligible to ingest, which is not a failure. A row whose search
// succeeded but whose every eligible Upsert then failed is left unmarked —
// marking it would freeze the cell at zero ingested rows for the whole TTL,
// the exact Belgrade failure mode (2 restaurants for 14 days) the
// Tripadvisor sweep's own MarkSynced gate exists to avoid. That must be
// distinguished from a row whose search succeeded but returned only
// sub-floor or wrong-category venues (both a common, unremarkable outcome —
// a niche subtype in a smaller city rarely clears the floor, and a
// type-overlapping row often finds venues its own category doesn't own):
// that row has nothing to ingest through no fault of its own and must still
// be marked fresh, or it re-searches on every future query forever —
// trading the stale-data bug for an unbounded quota-spend one. A single
// Upsert failure is logged and skipped without abandoning the rest of the
// row.
//
// tally records every Places call this row makes — just the one search call
// per row (T5, places-api-cost-reduction removed the per-venue ResolvePhotos
// call this used to also record; see the no-photo-resolve comment below),
// split by SKU tier — nil for syncGoogleIfNeeded's live per-request sync,
// which has no report to build (see placesCallTally's doc); PrewarmGoogle
// passes a real one to track its call budget.
func (a *Activities) syncGoogleRow(ctx context.Context, job googleSyncJob, cell cellLocation, radiusKM float64, tally *placesCallTally) {
	var found []placesmap.Place
	var err error
	if len(job.row.Types) > 0 {
		found, err = a.places.SearchNearby(ctx, places.NearbyRequest{
			Lat: job.anchor.Lat, Lng: job.anchor.Lng,
			RadiusM:       radiusKM * 1000,
			IncludedTypes: job.row.Types,
			MaxResults:    20,
		}, places.NearbyFieldMask)
	} else {
		// The ~5 subtypes Table A cannot express. Area-bounded so a phrase
		// like "escape room" can't pull in results from the next country.
		found, err = a.places.SearchTextInArea(ctx, job.row.TextQuery,
			job.anchor.Lat, job.anchor.Lng, radiusKM, places.NearbyFieldMask)
	}
	tally.record(places.NearbyFieldMask)
	if err != nil {
		slog.Warn("google discovery row failed",
			"category", job.row.Category, "subtype", job.row.Subtype, "error", err)
		return
	}

	passed, kept, skipped := 0, 0, 0
	var skippedTypes []string
	for _, p := range found {
		if !placesmap.PassesFloor(p) {
			continue
		}
		if venueWrongCategory(job.row, p) {
			// Arbitrated away, not a floor rejection and not an upsert
			// failure — must not touch passed/kept, or a row whose every
			// venue is skipped would look like "found eligible places but
			// every upsert failed" below and get left unmarked forever
			// instead of correctly marked fresh (see venueWrongCategory's
			// doc and this function's own doc above).
			skipped++
			if !slices.Contains(skippedTypes, p.PrimaryType) {
				skippedTypes = append(skippedTypes, p.PrimaryType)
			}
			continue
		}
		passed++
		// No photo resolve at discovery time (T5, places-api-cost-reduction):
		// most discovered venues are never opened, so a Google-billed
		// PhotoMediaURL call per venue here was mostly wasted spend. A venue
		// lands with zero photos until GetPhotos resolves them on first
		// detail view — the client already renders a missing-image
		// placeholder for that case, same as a photo-resolve failure always
		// produced before this change. tally therefore never sees a "photos"
		// entry for this row — see tally's own doc above, updated by T5 to
		// drop the ResolvePhotos-per-venue call it used to record.
		if _, err := a.repo.Upsert(ctx, toIngest(job.row, p, nil, cell)); err != nil {
			slog.Warn("google sync upsert failed", "place_id", p.ID, "error", err)
			continue
		}
		kept++
	}
	if passed > 0 && kept == 0 {
		slog.Warn("google discovery row found eligible places but every upsert failed; leaving unmarked to retry",
			"category", job.row.Category, "subtype", job.row.Subtype, "found", len(found), "passed", passed)
		return
	}

	cellKey := syncCellKey(job.anchor.Lat, job.anchor.Lng)
	if err := a.repo.MarkSynced(ctx, ProviderGoogle, cellKey, string(job.row.Category), job.row.Subtype, radiusKM); err != nil {
		slog.Warn("google mark-synced failed", "cell", cellKey, "category", job.row.Category, "subtype", job.row.Subtype, "error", err)
		return
	}
	slog.Info("google discovery row synced",
		"cell", cellKey, "category", job.row.Category, "subtype", job.row.Subtype,
		"found", len(found), "kept", kept, "skipped_wrong_category", skipped,
		"skipped_wrong_category_types", skippedTypes)
}

// toIngest maps one discovered place onto the ingest shape. Category always
// comes from the discovery row. Subcategory is arbitrated (see subtypeFor).
// City/Country come from cell — resolved once per sync cell via
// ReverseGeocodeCity, consistent across every venue the sweep ingests there.
// Deliberately no per-venue fallback to the place's own address components
// (placesmap.CityCountry used to fill this gap): that field yields the
// place's *local* name (e.g. "Beograd") rather than the canonical one cell
// resolution produces, and per-venue derivation was the original source of
// one city fragmenting into eight stored strings (see cellLocation's doc).
// An empty cell resolution (geocode failure, ZERO_RESULTS, or no Places
// client) is written through as empty — Upsert's ON CONFLICT
// COALESCE(NULLIF(EXCLUDED.city, empty-string), activities.city) preserves what is
// already stored rather than blanking it, and Country in particular stays
// load-bearing regardless: BuildLiveDetails' opening-hours timezone lookup
// keys off it.
//
// Details is deliberately empty — Places Terms §14.3 permits caching only
// place_id and lat/lng, so hours, price and venue type are fetched live on
// detail view instead (see placesmap.BuildLiveDetails).
func toIngest(row placesmap.DiscoveryRow, p placesmap.Place, photos []activitiessvc.Photo, cell cellLocation) activitiessvc.IngestActivity {
	return activitiessvc.IngestActivity{
		Title:       p.DisplayName.Text,
		Category:    row.Category,
		Subcategory: subtypeFor(row, p),
		Lat:         p.Location.Latitude,
		Lng:         p.Location.Longitude,
		City:        cell.City,
		Country:     cell.Country,
		Address:     p.FormattedAddress,
		Rating:      p.Rating,
		Status:      activitiessvc.StatusPublished,
		Photos:      photos,
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
//
// A local venue-type keyword in the place's own name (namemap.Subtype's
// override result) outranks all of the above: Google systematically labels
// Serbian shisha bars and kafanas as cafe/lounge/nightclub, and the name is
// the more accurate signal. A non-override keyword is the last resort before
// the row's own subtype, so it can only fill what Google left empty.
//
// This function must stay deterministic for a given (row, place): Upsert
// overwrites subcategory unconditionally, so a re-sync recomputes this and
// would otherwise revert cmd/backfillsubtype's work.
func subtypeFor(row placesmap.DiscoveryRow, p placesmap.Place) string {
	nameSlug, override := namemap.Subtype(row.Category, p.DisplayName.Text)
	if override {
		return nameSlug
	}
	if sub := placesmap.Subtype(row.Category, p.PrimaryType, p.Types); sub != "" {
		return sub
	}
	if nameSlug != "" {
		return nameSlug
	}
	return row.Subtype
}

// venueWrongCategory reports whether p was found by a row that is not its
// own category, so syncGoogleRow should skip ingesting it under that row —
// the venue will be, or already has been, upserted by its true category's
// own row instead.
//
// The problem this fixes: the upsert key is (source_url, category), so a
// venue whose types happen to satisfy two different categories' includedTypes
// (a children's playroom typed "amusement_center" also matching Nature's
// "park"-adjacent search, say) is upserted once per matching row — TWO rows,
// TWO stored categories for one venue. The query layer only collapses that
// down to one when no category filter is active; under a category chip the
// misclassified copy still shows (the motivating case: "Igraonica New
// Curance", a children's playroom, appearing under nature/botanical_garden).
//
// placesmap.CategoryForType is the same inverted DiscoveryRows index
// subtypeFor's placesmap.Subtype call uses, just read at the category level
// instead of the subtype level: it says what category the place's own
// primaryType actually belongs to. When that disagrees with row.Category,
// row is the wrong source for this venue and skips it. When primaryType maps
// to nothing, there's no better signal than the row that found it, so the
// existing behavior (trust the row) is kept — same fallback shape as
// subtypeFor's "row's own subtype when primaryType maps to nothing".
//
// The tradeoff, stated plainly: this makes a venue single-category whenever
// Google states a primary type, even when the venue genuinely belongs to
// more than one — Tašmajdan really is both a park and a cluster of sports
// courts, and after this change it surfaces only under its primaryType's
// category. That's an accepted cost: correct category chips (no playroom
// under Nature) matter more than preserving genuine multi-category
// membership, and nothing in Places' response distinguishes "this venue
// truly belongs to two categories" from "this venue was misclassified by an
// overlapping type list" — there is no signal here to tell the two apart, so
// the simpler, single-category rule is the one that's actually implementable.
//
// Never arbitrate a TextQuery row (len(row.Types) == 0), though. Five
// subtypes — escape_room, lounge, climbing_gym, kids_museum,
// meditation_center — have NO Table A type at all; they exist as phrase
// searches precisely because no includedTypes list can express them. Google
// still assigns those venues *some* primaryType (an escape room commonly
// comes back as "amusement_center", Kids' own type), and arbitrating on that
// would skip the phrase row's own upsert in favor of a category the venue
// only incidentally overlaps — permanently, since no other row can ever
// produce these five subtypes. A venue a targeted name query matched is
// stronger evidence for its subtype than an incidental type overlap, so
// trust the row unconditionally here.
func venueWrongCategory(row placesmap.DiscoveryRow, p placesmap.Place) bool {
	if len(row.Types) == 0 {
		return false
	}
	trueCategory, ok := placesmap.CategoryForType(p.PrimaryType)
	return ok && trueCategory != row.Category
}
