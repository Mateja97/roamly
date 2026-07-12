package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

func writeJSON(w http.ResponseWriter, status int, body any, logger *slog.Logger) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		// ponytail: status code already sent, nothing left to do but log —
		// this only fires on a write-side failure (client gone, NaN/Inf).
		logger.Error("encode response body", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string, logger *slog.Logger) {
	writeJSON(w, status, struct {
		Error string `json:"error"`
	}{Error: message}, logger)
}
