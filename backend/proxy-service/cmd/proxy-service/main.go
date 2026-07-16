package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	activitiesclient "backend/shared/clients/activitiessvc"
	sharedconfig "backend/shared/config"
	"backend/shared/logging"

	"proxy-service/internal/api"
	"proxy-service/internal/health"
	"proxy-service/internal/middleware"
)

func main() {
	logger := logging.New(sharedconfig.OrDefault("LOG_LEVEL", "info"))

	addr := sharedconfig.OrDefault("HTTP_ADDR", ":8080")
	activitiesAddr := sharedconfig.OrDefault("ACTIVITIES_SERVICE_ADDR", "activities-service:9090")

	activitiesClient, err := activitiesclient.Dial(activitiesAddr)
	if err != nil {
		logger.Error("startup failed", "error", err)
		os.Exit(1)
	}
	defer func() {
		if err := activitiesClient.Close(); err != nil {
			logger.Error("closing activities client", "error", err)
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", health.Handler())
	mux.HandleFunc("POST /activities/query", api.NewQueryActivitiesHandler(activitiesClient, logger).Handle)
	mux.HandleFunc("GET /cities/suggest", api.NewSuggestCitiesHandler(activitiesClient, logger).Handle)

	// Admin surface (T2): fail closed. An unset/empty ADMIN_API_TOKEN means
	// these routes are never registered at all — never "everything
	// allowed" — so an accidental deployment without the token simply has
	// no /admin/* surface (a 404, same as any other unmatched path).
	if !api.RegisterAdminRoutes(mux, activitiesClient, os.Getenv("ADMIN_API_TOKEN"), logger) {
		logger.Warn("ADMIN_API_TOKEN not set: /admin routes are disabled")
	}

	srv := &http.Server{Addr: addr, Handler: middleware.CORS(mux)}

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("proxy-service starting", "addr", addr)
		if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
			return
		}
		serveErr <- nil
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-serveErr:
		if err != nil {
			logger.Error("proxy-service stopped", "error", err)
			os.Exit(1)
		}
	case <-stop:
		logger.Info("shutting down")
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			logger.Error("graceful shutdown failed", "error", err)
		}
	}
}
