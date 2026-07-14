// Command activities-service serves the ActivitiesService gRPC API: entrypoint
// only, wires config, db, and the api/service/repository layers.
package main

import (
	"context"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	sharedconfig "backend/shared/config"
	shareddb "backend/shared/db"
	"backend/shared/logging"

	"activities-service/internal/api"
	"activities-service/internal/repository"
	"activities-service/internal/service"
)

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
	svc := service.New(repo)
	grpcServer := api.NewGRPCServer(svc, logger)

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
