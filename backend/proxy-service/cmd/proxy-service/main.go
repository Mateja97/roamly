package main

import (
	"log/slog"
	"net/http"
	"os"

	"proxy-service/internal/health"
)

func main() {
	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", health.Handler())

	slog.Info("proxy-service starting", "addr", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		slog.Error("proxy-service stopped", "error", err)
		os.Exit(1)
	}
}
