package main

import (
	"net/http"
	"os"

	activitiesclient "backend/shared/clients/activitiessvc"
	sharedconfig "backend/shared/config"
	"backend/shared/logging"

	"proxy-service/internal/api"
	"proxy-service/internal/health"
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

	logger.Info("proxy-service starting", "addr", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		logger.Error("proxy-service stopped", "error", err)
		os.Exit(1)
	}
}
