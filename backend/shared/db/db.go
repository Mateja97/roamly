// Package db provides the common Postgres connection setup and a minimal
// migration runner shared by every service that owns a database. Uses pgx's
// native pool (not the database/sql compatibility shim) so array columns
// (text[]) decode straight into Go slices without hand-rolled parsing.
package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect opens a pooled connection to Postgres and verifies it is reachable.
func Connect(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("opening db pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("pinging db: %w", err)
	}
	return pool, nil
}
