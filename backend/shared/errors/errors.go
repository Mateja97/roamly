// Package errors holds the sentinel errors every service's repository layer
// maps raw driver errors to, and every service's api layer maps to
// transport status codes the same way. See GO_STANDARDS.md "Errors".
package errors

import "errors"

var (
	ErrNotFound         = errors.New("not found")
	ErrConflict         = errors.New("conflict")
	ErrInvalidInput     = errors.New("invalid input")
	ErrPermissionDenied = errors.New("permission denied")
)
