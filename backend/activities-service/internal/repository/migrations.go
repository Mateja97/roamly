package repository

import (
	"embed"
	"io/fs"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Migrations returns the embedded schema + seed SQL files as a flat
// directory (rooted at "migrations/") so shared/db.Migrate can list them.
func Migrations() fs.FS {
	sub, err := fs.Sub(migrationsFS, "migrations")
	if err != nil {
		panic(err) // unreachable: the embed directive guarantees this path exists
	}
	return sub
}
