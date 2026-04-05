# Changelog

## v1.19.0 (2026-04-05)
- README: update component table (17→20), test counts (476→581), add parallelDispatch + aggregateResults
- Helm version reference updated to v1.18.0

## v1.18.0 (2026-04-05)
- Logger JSON mode: filter undefined values from data before spread (consistency with text mode)
- Tests: exec-helper unit tests (18), logger undefined filtering tests (JSON + text)
- 21 test suites, 581 tests total

## v1.17.0 (2026-04-05)
- Code review: logger filters undefined values from text output (no more `key=undefined`)
- Code review: SQSInput.listen() try/catch prevents silent poll loop death on callback error
- Full code review of all 26 source files — no other DRY/security/quality issues found

## v1.16.0 (2026-04-05)
- Security: sanitize bridge writeResult requestId to prevent path traversal
- Component table: 20 components (added SQS input, SQS dispatcher)
- README: updated component table with all 20 components

## v1.15.0 (2026-04-05)
- Task sharding: parallel dispatch with dependency graph (dependsOn), per-task worker selection
- Sharder module: cartesian/round-robin/chunk strategies for splitting tasks across dimensions
- parallelDispatch + aggregateResults for distributed work (EP incident response ready)
- Event-driven bridge: fs.watch for instant task pickup (no more polling delay)
- Priority-aware queue: critical/high/normal/low levels, highest priority dequeued first
- SQS input: receive tasks from AWS SQS with long-polling and message deletion
- SQS dispatcher: distribute sharded work units via SQS task/result queues
- DRY: bridge _readFile extracted, poll() and listen() share logic
- 20 components, 19+ test suites, 511+ tests total

## v1.14.0 (2026-04-05)
- Helm chart for one-command K8s deployment (`helm install ccc helm/ccc-manager/`)
- Templated: Deployment, Service, ConfigMap, PVC, NetworkPolicy, ServiceMonitor
- Configurable via `values.yaml`: image, resources, persistence, bridge, networkPolicy
- Config checksum annotation triggers rolling restart on ConfigMap changes
- Bridge volume supports existing PVC for shared storage with target project pods
- RONE values overlay (`values-rone.yaml`) for hackathon-teams-poller deployment
- Helm chart test suite (49 tests) — validates structure, templates, helpers, security defaults
- 17 test suites, 444+ tests total

## v1.13.0 (2026-04-05)
- DRY: MultiManager.start() delegates to Manager.start() (removed 22-line duplication)
- README: multi-instance CLI usage, MultiManager API, updated test counts

## v1.12.0 (2026-04-05)
- Multi-instance support: run multiple configs from one process
- Per-instance state isolation (`state/<name>/` directories)
- Instance-labeled Prometheus metrics (`{instance="name"}` labels)
- `MultiManager` class with shared health endpoint (aggregated /healthz, /readyz, /metrics)
- CLI accepts multiple config files: `ccc-manager a.yaml b.yaml`
- `--health-port` flag for shared health endpoint port
- `--status` shows per-instance state when subdirs exist
- 36 new multi-instance tests (16 suites, 395 tests total)

## v1.11.0 (2026-04-05)
- GitHub Actions test CI (Node 18/20/22 matrix)
- README.md with quickstart, architecture, component table
- Grafana dashboard included in Docker image
- GitHub issues input added to rone-teams-poller config
- Fix secret-scan self-match (PRIVATE KEY grep matched its own workflow file)
- Cleaned up 14+ stale remote branches

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
