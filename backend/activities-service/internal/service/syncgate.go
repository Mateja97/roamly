package service

import "sync"

// syncCellGate all-or-nothing claims a background sync sweep's cells so two
// concurrent sweeps never cover the same cell at once — see googleSyncCells'
// doc for the double-sync cost this avoids. Cells are claimed synchronously
// before the sweep's goroutine is spawned (so a second caller for the same
// cell sees the claim immediately, not just once the first goroutine gets
// scheduled) and released via defer when the goroutine returns on every exit
// path, including panic.
//
// googleSyncCells (googlesync.go) and tripadvisorSyncCells (activity.go)
// are each their own instance: same claim/release shape, but a separate
// provider means a separate quota and in-flight set, so they must never
// share one map — a Google sweep and a Tripadvisor sweep at the same
// coordinates are unrelated and both allowed to run.
type syncCellGate struct {
	mu       sync.Mutex
	inFlight map[string]struct{}
}

// claim claims every cell in cells atomically: either all are free and all
// get claimed, or none are (some other sweep already covers at least one of
// them) and nothing is claimed. All-or-nothing is simpler than partial
// claiming and just as safe, since the caller drops the whole sweep either
// way when the claim fails.
func (g *syncCellGate) claim(cells []string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, c := range cells {
		if _, busy := g.inFlight[c]; busy {
			return false
		}
	}
	for _, c := range cells {
		g.inFlight[c] = struct{}{}
	}
	return true
}

// release undoes claim. Always called via defer so a claimed cell is freed
// no matter how the sweep's goroutine exits.
func (g *syncCellGate) release(cells []string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, c := range cells {
		delete(g.inFlight, c)
	}
}
