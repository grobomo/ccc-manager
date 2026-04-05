# Spec 009: Harden Runtime

## Goal
Make the manager production-ready: fix YAML parser edge cases, add graceful shutdown with queue draining, and add HTTP health endpoints for K8s probes.

## Changes

### T040: YAML Parser Hardening
- Strip surrounding quotes from values (preserves as string)
- Support list items with key:value pairs (object lists)
- 31 dedicated parser tests covering edge cases and regressions

### T041: Graceful Shutdown
- `stop()` drains queued tasks before exiting (with configurable timeout)
- Double-stop is safe (idempotent)
- Remaining tasks persist to disk for restart recovery

### T043: Health Endpoint
- HTTP server on configurable port (default 8080)
- `/healthz` — liveness probe (200 if running)
- `/readyz` — readiness probe (200 if running + dispatcher loaded)
- `/metrics` — JSON metrics snapshot
- Server closes cleanly on shutdown
