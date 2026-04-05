# Changelog

## v1.10.0 (2026-04-05)
- Dockerfile: only include example config, not project-specific files
- `.dockerignore` for leaner images
- `npm run healthcheck` and `npm run validate` scripts
- Test runner shows suite names in output
- CHANGELOG.md added

## v1.9.0 (2026-04-05)
- Test suite reliability: all 15 suites exit cleanly on Windows (libuv drain fix)
- Test runner: distinguish real test failures from process crashes
- Healthcheck script for ops probing (`npm run healthcheck`)
- PersistentVolumeClaim for state persistence across pod restarts
- NetworkPolicy for K8s traffic restriction (ingress/egress)

## v1.8.0 (2026-04-05)
- CLI `--dry-run` flag: run one cycle without executing workers
- CLI `--status` flag: print queue/metrics without starting
- Fix dedup bypass in webhook listen callback
- GitHubInput: eliminate shell injection via `execFileSync`
- Container security: non-root Dockerfile, K8s `securityContext`

## v1.7.0 (2026-04-04)
- CLI `--help`, `--version`, `--validate`, `--list-components` flags
- K8s deployment manifests with Kustomize support

## v1.6.0 (2026-04-04)
- Grafana dashboard JSON (importable)
- Config schema documentation
- Docker image build verification

## v1.5.0 (2026-04-04)
- Config hot-reload (file watch + SIGHUP)
- File notifier for bridge result consumption
- Prometheus `/metrics` endpoint (text exposition format)
- Uptime and last_reload gauges

## v1.4.0 (2026-04-04)
- Cron monitor: independent schedule checks
- File notifier: write results to disk

## v1.3.0 (2026-04-04)
- Logger export for plugins
- LogMonitor efficiency: file offset instead of full read
- Structured JSON logging mode

## v1.2.0 (2026-04-03)
- AI-powered Claude dispatcher (`claude -p`)
- Configurable dedup window and history rotation
- Plugin loader for custom components
- Config validation at startup

## v1.1.0 (2026-04-03)
- Webhook input (HTTP POST with HMAC auth)
- Webhook/Slack/Teams notifiers
- Retry logic for failed tasks
- Body size limit and timing-safe HMAC

## v1.0.0 (2026-04-03)
- Core framework: monitors, inputs, dispatcher, verifiers, workers
- Built-in components: process monitor, log monitor, bridge/alert input
- SHTD dispatcher, test-suite verifier, local/K8s/EC2 workers
- State persistence, dedup, metrics
- Health endpoint (`/healthz`, `/readyz`, `/metrics`)
- Graceful shutdown with queue draining
- Zero npm dependencies
