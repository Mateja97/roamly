// Command activities-service serves the ActivitiesService gRPC API: entrypoint
// only, wires config, db, and the api/service/repository layers.
package main

import (
	"context"
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

// defaultGoogleSyncTTLDays mirrors service.defaultGoogleSyncTTL — kept here,
// not imported, since it's just the fallback string for
// sharedconfig.OrDefault below and main.go stays the only place env vars are
// read (GO_STANDARDS.md's config convention).
const defaultGoogleSyncTTLDays = "30"

// googleSyncTTLFromEnv parses GOOGLE_SYNC_TTL_DAYS (T4,
// places-api-cost-reduction) into a duration, falling back to
// service.defaultGoogleSyncTTL — via defaultGoogleSyncTTLDays — on anything
// that isn't a positive integer, so a malformed override degrades to the
// default instead of killing startup over a config knob that was already
// optional.
func googleSyncTTLFromEnv(raw string) time.Duration {
	days, err := strconv.Atoi(raw)
	if err != nil || days <= 0 {
		days, _ = strconv.Atoi(defaultGoogleSyncTTLDays)
	}
	return time.Duration(days) * 24 * time.Hour
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
	svc := service.New(repo).WithGoogleSyncTTL(googleSyncTTLFromEnv(sharedconfig.OrDefault("GOOGLE_SYNC_TTL_DAYS", defaultGoogleSyncTTLDays)))
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
