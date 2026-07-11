package api

import (
	"context"
	"log/slog"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	activitiesv1 "backend/shared/proto/activities/v1"
)

// NewGRPCServer wires the ActivitiesService handler with logging and
// panic-recovery interceptors.
// ponytail: no grpc health service — nothing in this stack probes it yet
// (no k8s, compose has no healthcheck for any backend service); add
// google.golang.org/grpc/health when something starts depending on readiness.
func NewGRPCServer(svc queryService, logger *slog.Logger) *grpc.Server {
	srv := grpc.NewServer(
		grpc.ChainUnaryInterceptor(loggingInterceptor(logger), recoveryInterceptor(logger)),
	)
	activitiesv1.RegisterActivitiesServiceServer(srv, NewServer(svc, logger))
	return srv
}

func loggingInterceptor(logger *slog.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		start := time.Now()
		resp, err := handler(ctx, req)
		logger.Info("grpc request", "method", info.FullMethod, "duration", time.Since(start), "code", status.Code(err))
		return resp, err
	}
}

// recoveryInterceptor turns a handler panic into codes.Internal instead of
// crashing the process and dropping every other in-flight RPC.
func recoveryInterceptor(logger *slog.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (resp any, err error) {
		defer func() {
			if r := recover(); r != nil {
				logger.Error("grpc handler panic", "method", info.FullMethod, "panic", r)
				err = status.Error(codes.Internal, "internal error")
			}
		}()
		return handler(ctx, req)
	}
}
