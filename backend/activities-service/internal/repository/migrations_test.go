package repository

import (
	"io/fs"
	"strings"
	"testing"
)

// grandfatheredDuplicateNumbers are the three numeric prefixes that were each
// used twice before this guard existed. They are deliberately NOT renamed:
// shareddb.Migrate records applied migrations by full filename, so renaming a
// file makes the runner treat it as new and re-apply it. For these three that
// is destructive rather than merely wasteful —
// 0011_import_belgrade_listings.sql is a bare INSERT with no ON CONFLICT (a
// re-run inserts 120 duplicate rows) and 0023_clear_places_details.sql wipes
// details on every google_places row (a re-run destroys the website-sync
// scraped content). A follow-up migration cannot repair the bookkeeping
// either: a renamed 0011a_*.sql sorts before any 00NN_*.sql high enough to
// hold the fix, so it re-applies first. They are already applied everywhere
// and sort deterministically, so they are inert where they are.
var grandfatheredDuplicateNumbers = map[string]bool{"0011": true, "0012": true, "0023": true}

// TestMigrationNumbersAreUnique keeps new migrations from colliding on a
// numeric prefix. Collisions are silent: Migrate sorts by full filename, so a
// new 0023_add_index.sql would apply BETWEEN the two existing 0023 files
// rather than after them — ordering that holds on a fresh database but not on
// one where the existing pair already ran, making the schema depend on when
// an environment was created.
func TestMigrationNumbersAreUnique(t *testing.T) {
	entries, err := fs.ReadDir(Migrations(), ".")
	if err != nil {
		t.Fatalf("reading migrations: %v", err)
	}

	byNumber := map[string][]string{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		number, _, ok := strings.Cut(e.Name(), "_")
		if !ok {
			t.Errorf("migration %q has no NNNN_name.sql numeric prefix", e.Name())
			continue
		}
		byNumber[number] = append(byNumber[number], e.Name())
	}

	if len(byNumber) == 0 {
		t.Fatal("no migrations found — the embed directive is broken")
	}

	for number, files := range byNumber {
		if len(files) > 1 && !grandfatheredDuplicateNumbers[number] {
			t.Errorf("migration number %s used by %d files: %v\n"+
				"Renumber the new one to the next free prefix. Do NOT rename an\n"+
				"already-applied migration: Migrate keys schema_migrations on the\n"+
				"full filename, so a rename re-applies the file.", number, len(files), files)
		}
	}

	// The grandfathered list must not outlive the collisions it excuses.
	for number := range grandfatheredDuplicateNumbers {
		if len(byNumber[number]) <= 1 {
			t.Errorf("number %s is grandfathered but no longer collides — drop it from grandfatheredDuplicateNumbers", number)
		}
	}
}
