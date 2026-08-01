package db

import "testing"

// TestPoolConfig_MaxConns is the one runnable check for poolConfig's branch:
// a DSN with no pool_max_conns of its own gets defaultMaxConns, and a DSN
// that already sets pool_max_conns is left alone — no live Postgres needed,
// since poolConfig never dials.
func TestPoolConfig_MaxConns(t *testing.T) {
	cfg, err := poolConfig("postgres://user:pass@localhost:5432/db")
	if err != nil {
		t.Fatalf("poolConfig() error: %v", err)
	}
	if cfg.MaxConns != defaultMaxConns {
		t.Errorf("MaxConns = %d, want defaultMaxConns (%d) when the DSN sets none", cfg.MaxConns, defaultMaxConns)
	}

	cfg, err = poolConfig("postgres://user:pass@localhost:5432/db?pool_max_conns=25")
	if err != nil {
		t.Fatalf("poolConfig() error: %v", err)
	}
	if cfg.MaxConns != 25 {
		t.Errorf("MaxConns = %d, want 25 from the DSN's own pool_max_conns", cfg.MaxConns)
	}
}
