// Command activities-service serves the ActivitiesService gRPC API: entrypoint
// only, wires config, db, and the api/service/repository layers.
package main

import (
	"context"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
	_ "time/tzdata" // ponytail: alpine runtime has no /usr/share/zoneinfo; bundle IANA DB into binary instead of apk-installing tzdata

	sharedconfig "backend/shared/config"
	shareddb "backend/shared/db"
	"backend/shared/logging"

	"activities-service/internal/api"
	"activities-service/internal/photo"
	"activities-service/internal/places"
	"activities-service/internal/repository"
	"activities-service/internal/service"
	"activities-service/internal/tripadvisor"
)

// maxResolvedPhotosFromEnv parses raw as a positive int, falling back to
// service.DefaultMaxResolvedPhotos on anything else (unset, non-numeric,
// <= 0) — bad config degrading to the safe default beats refusing to start
// over a photo cap. A non-empty but invalid raw is logged so a typo'd env
// var doesn't silently become the default.
func maxResolvedPhotosFromEnv(raw string, logger *slog.Logger) int {
	if raw == "" {
		return service.DefaultMaxResolvedPhotos
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		logger.Warn("invalid MAX_RESOLVED_PHOTOS, using default", "value", raw, "default", service.DefaultMaxResolvedPhotos)
		return service.DefaultMaxResolvedPhotos
	}
	return n
}

func main() {
	logger := logging.New(sharedconfig.OrDefault("LOG_LEVEL", "info"))

	dsn, err := sharedconfig.Require("DATABASE_URL")
	if err != nil {
		logger.Error("startup failed", "error", err)
		os.Exit(1)
	}
	grpcAddr := sharedconfig.OrDefault("GRPC_ADDR", ":9090")

	ctx := context.Background()
	db, err := shareddb.Connect(ctx, dsn)
	if err != nil {
		logger.Error("startup failed", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := shareddb.Migrate(ctx, db, repository.Migrations()); err != nil {
		logger.Error("startup failed", "error", err)
		os.Exit(1)
	}

	repo := repository.New(db)
	svc := service.New(repo).WithMaxResolvedPhotos(maxResolvedPhotosFromEnv(os.Getenv("MAX_RESOLVED_PHOTOS"), logger))
	// GOOGLE_MAPS_API_KEY is optional (T2): unset, the server still runs
	// fine, GetActivityPhotos just always answers from stored photos with no
	// live Google call — same fallback behavior a configured client hits on
	// error/timeout, so this is deliberately not a fail-fast Require.
	if key := sharedconfig.OrDefault("GOOGLE_MAPS_API_KEY", ""); key != "" {
		svc = svc.WithPlaces(places.New(key))
	}
	// TRIPADVISOR_API_KEY is optional, same fallback contract as
	// GOOGLE_MAPS_API_KEY above: unset, the server still runs fine —
	// Restaurants/Bars simply never lazily sync and GetActivityPhotos never
	// resolves Tripadvisor-sourced photos live, both falling back to
	// whatever's already stored.
	if key := sharedconfig.OrDefault("TRIPADVISOR_API_KEY", ""); key != "" {
		svc = svc.WithTripadvisor(tripadvisor.New(key))
	}
	photos := photo.NewStore(sharedconfig.OrDefault("PHOTOS_DIR", "/data/photos"))
	grpcServer := api.NewGRPCServer(svc, photos, logger)

	lis, err := net.Listen("tcp", grpcAddr)
	if err != nil {
		logger.Error("startup failed", "error", err)
		os.Exit(1)
	}

	go func() {
		logger.Info("activities-service starting", "addr", grpcAddr)
		if err := grpcServer.Serve(lis); err != nil {
			logger.Error("grpc server stopped", "error", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	logger.Info("shutting down")
	stopped := make(chan struct{})
	go func() {
		grpcServer.GracefulStop()
		close(stopped)
	}()
	select {
	case <-stopped:
	case <-time.After(15 * time.Second):
		grpcServer.Stop()
	}
}
