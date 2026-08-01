// Package db provides the common Postgres connection setup and a minimal
// migration runner shared by every service that owns a database. Uses pgx's
// native pool (not the database/sql compatibility shim) so array columns
// (text[]) decode straight into Go slices without hand-rolled parsing.
package db

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// defaultMaxConns bounds the pool when the DSN doesn't set its own via
// pool_max_conns. pgxpool.New's own default is max(4, NumCPU) — unbounded
// enough that a background sweep (this service's Google/Tripadvisor lazy
// sync, or a batch tool like cmd/scrapecity) can open as many connections as
// the box has cores and starve foreground request queries sharing the same
// pool. 10 is comfortably above one service's normal foreground concurrency
// while still leaving headroom under Postgres's own default
// max_connections (100) when several services share one instance.
const defaultMaxConns = 10

// poolConfig parses dsn and applies defaultMaxConns, split out from Connect
// so the resolution logic is testable without a live Postgres to dial.
func poolConfig(dsn string) (*pgxpool.Config, error) {
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parsing db config: %w", err)
	}
	// pgxpool.ParseConfig already applies a DSN's own pool_max_conns (as
	// either a "pool_max_conns=N" keyword or a "?pool_max_conns=N" query
	// param) to config.MaxConns, so only fall back to defaultMaxConns when
	// the DSN didn't specify one — an operator can still override this per
	// environment without a code change.
	if !strings.Contains(dsn, "pool_max_conns") {
		config.MaxConns = defaultMaxConns
	}
	return config, nil
}

// Connect opens a pooled connection to Postgres and verifies it is reachable.
func Connect(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	config, err := poolConfig(dsn)
	if err != nil {
		return nil, err
	}

	pool, err := pgxpool.NewWithConfig(ctx, config)
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
