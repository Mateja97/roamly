package db

import (
	"context"
	"fmt"
	"io/fs"
	"sort"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Migrate applies every *.sql file in migrationsFS, in filename order, that
// isn't already recorded in schema_migrations. Each file runs in its own
// transaction. ponytail: no up/down pairs or rollback tooling — this is an
// append-only forward migration runner, the right size for a service with
// one schema history; add a real migration tool if down-migrations are ever needed.
func Migrate(ctx context.Context, pool *pgxpool.Pool, migrationsFS fs.FS) error {
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename    TEXT PRIMARY KEY,
			applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
		)`); err != nil {
		return fmt.Errorf("creating schema_migrations table: %w", err)
	}

	entries, err := fs.ReadDir(migrationsFS, ".")
	if err != nil {
		return fmt.Errorf("reading migrations dir: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		var applied bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE filename = $1)`, name,
		).Scan(&applied); err != nil {
			return fmt.Errorf("checking migration %s: %w", name, err)
		}
		if applied {
			continue
		}

		sqlBytes, err := fs.ReadFile(migrationsFS, name)
		if err != nil {
			return fmt.Errorf("reading migration %s: %w", name, err)
		}

		tx, err := pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("beginning tx for migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, string(sqlBytes)); err != nil {
			_ = tx.Rollback(ctx) // tx is already dead after the error above; nothing to act on
			return fmt.Errorf("applying migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO schema_migrations (filename) VALUES ($1)`, name); err != nil {
			_ = tx.Rollback(ctx) // tx is already dead after the error above; nothing to act on
			return fmt.Errorf("recording migration %s: %w", name, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("committing migration %s: %w", name, err)
		}
	}
	return nil
}
