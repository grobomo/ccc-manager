# CCC Manager — TODO

## Session Handoff (2026-04-05, session 22)

**What was done this session:**
- Full code review of all 22 source files — clean, secure, well-structured
- T139-T142: Helm chart (7 templates), RONE values overlay, chart test suite, v1.14.0
- 17 suites, 444 tests, 0 failures

**Current state:** v1.14.0 on branch 063-T139-helm-chart. 17 components, 444 tests across 17 suites.
**All CI green:** Tests (Node 18/20/22) + Secret Scan pass on GitHub Actions.

**Next priorities (zoom out):**
- Real integration with rone-teams-poller: deploy to K8s with Helm, test with actual RONE bridge files
- Cross-project: rone-teams-poller has SELF_REPAIR routing to this manager's bridge + GitHub issues input

## Needed by ep-incident-response (cross-project blocker)
EP incident response project needs a reusable dispatcher/distribution framework for parallel V1 analysis.
Currently blocked because distribution logic doesn't exist as a pluggable component.

- [x] T148 Enhance T143 sharding for EP: Sharder class with cartesian/chunk/round-robin, EP test (3×3×3=27 units)
- [ ] T149 Add priority-aware dispatch: critical/high/normal/low priority levels, critical tasks scheduled first
- [ ] T150 Add SQS-backed dispatcher mode: EC2Worker exists, but need dispatcher that queues to SQS instead of locally. EP fleet uses SQS for task/result queues.
- [x] T151 Add result aggregation: aggregateResults() with custom merge function, status rollup
- [ ] T152 Package as standalone dispatcher-api.py that ep-incident-response can download from S3 and run on the dispatcher EC2 instance

## Completed Phases (1-8)
- Phase 1: Core framework (base classes, config, registry, state, runtime)
- Phase 2: Input sources (BridgeInput, AlertInput, ProcessMonitor)
- Phase 3: Worker distribution (SHTDDispatcher, TestSuiteVerifier, LocalWorker)
- Phase 4: Per-project configs (rone-teams-poller.yaml, claude-portable.yaml)
- Phase 5: Harden & publish (dedup, metrics fix, secret-scan CI, git config)
- Phase 6: Environment workers (K8sWorker, EC2Worker, LogMonitor, GitHubInput)
- Phase 7: Deploy & integrate (Dockerfile, unified test runner, docs)
- Phase 8: gh_auto (auto GitHub account switching, enforcement hook)

## Components (17 built-in)
| Type | Name | File |
|------|------|------|
| Monitor | process | src/monitors/process.js |
| Monitor | log | src/monitors/log.js |
| Monitor | cron | src/monitors/cron.js |
| Input | bridge | src/inputs/bridge.js |
| Input | alert | src/inputs/alert.js |
| Input | github | src/inputs/github.js |
| Input | webhook | src/inputs/webhook.js |
| Dispatcher | shtd | src/dispatcher/shtd.js |
| Dispatcher | claude | src/dispatcher/claude.js |
| Verifier | test-suite | src/verifiers/test-suite.js |
| Worker | local | src/workers/local.js |
| Worker | k8s | src/workers/k8s.js |
| Worker | ec2 | src/workers/ec2.js |
| Notifier | webhook | src/notifiers/webhook.js |
| Notifier | file | src/notifiers/file.js |

## Phase 9: Harden Runtime
- [x] T040: YAML parser — quoted strings, object lists, 31 regression tests
- [x] T041: Graceful shutdown — drain queue on SIGTERM with configurable timeout
- [x] T042: Wire rone-teams-poller SELF_REPAIR → bridge with completedDir + format normalization
- [x] T043: Health endpoint — /healthz, /readyz, /metrics for K8s probes
- [x] T044: Package.json v1.0.0 — exports, bin, files, keywords, repository, MIT license
- [x] T045: Demo script (`npm run demo`) — live monitor→dispatch→verify cycle with health endpoint
- [x] Fix: State tracks failures metric (was undefined)

## Phase 10: Code Review Cleanup
- [x] T046: DRY — extract _processTask from runCycle/stop drain duplication
- [x] T047: CLI exit — process.exit after stop to avoid hanging on SIGTERM
- [x] T048: Security — fix command injection in EC2Worker SSM mode
- [x] T049: Register workers in builtins, wire workers into Manager.init
- [x] T050: Registry.registerWorker + getWorker support

## Phase 11: Next Value
- [x] T051: Publish to emu marketplace (PR #76 at trend-ai-taskforce/ai-skill-marketplace)
- [x] T052: Wire SHTDDispatcher to actually use workers for task execution
- [x] T053: Add webhook input (HTTP POST → task queue) for external CI/CD triggers
- [x] T054: Notification output — post results to Teams/Slack via webhook
- [x] T055: Add retry logic — failed tasks retry N times before marking as failed

## Phase 12: Security Hardening
- [x] T056: WebhookInput — add body size limit (1MB) and timing-safe HMAC comparison
- [x] T057: Update component counts, bump version to 1.1.0

## Phase 13: Polish & Integration
- [x] T058: DRY init() — extract _initComponents helper (30 lines → 10)
- [x] T059: Add webhook, notifier, worker, retry config examples

## Phase 14: AI-Powered Core
- [x] T060: Claude-powered dispatcher — calls `claude -p` for real spec generation
- [x] T061: Configurable dedup window (was hardcoded 1hr)
- [x] T062: History rotation — cap size, prune old entries
- [x] T063: Plugin loader — load custom components from file paths

## Phase 15: Hardening & Observability
- [x] T064: Fix command injection in GitHubInput (shell-escape repo/label args)
- [x] T065: Structured JSON logging mode for production deployments
- [x] T066: Config validation at startup — catch bad configs early

## Phase 16: Polish & Package
- [x] T067: Export logger for plugins, add package exports
- [x] T068: LogMonitor efficiency — use file offset instead of reading entire file
- [x] T069: Version bump to v1.3.0, update component docs

## Phase 17: Code Review Fixes
- [x] T070: WebhookNotifier — extend Notifier base class, add url validation
- [x] T071: Dispatcher dispatch() DRY — move shared dispatch() to base class

## Phase 18: Integration & E2E
- [x] T072: Update rone-teams-poller.yaml to use claude dispatcher
- [x] T073: E2E integration test — bridge task file → full pipeline with mock worker
- [x] T074: Marketplace PR #76 — fix Copilot review comments (SKILL.md frontmatter)

## Phase 19: Code Review Hardening
- [x] T075: K8sWorker command injection — quote task.command in kubectl exec
- [x] T076: WebhookNotifier use structured logger instead of console.error
- [x] T077: ProcessMonitor — truncate command in issue summary to avoid leaking secrets

## Phase 20: Extended Components
- [x] T078: Cron monitor — run checks on independent schedule (cron expression)
- [x] T079: File notifier — write results to disk for bridge consumption

## Phase 21: Runtime Polish
- [x] T080: Config hot-reload — watch config file, swap interval/maxRetries/dedupWindow at runtime
- [x] T081: Wire file notifier into rone-teams-poller.yaml for bridge result consumption
- [x] T082: Prometheus /metrics — text exposition format for K8s scraping

## Phase 22: Code Review Hardening
- [x] T083: Replace console.log/warn/error with structured logger in all components
- [x] T084: ClaudeDispatcher — fix shell injection via execFileSync

## Phase 23: Production Readiness
- [x] T085: SIGHUP config reload — K8s ConfigMap update pattern
- [x] T086: Uptime + last_reload Prometheus gauges

## Phase 24: Worker Security Hardening
- [x] T087: EC2Worker + K8sWorker — execFileSync with array args (no local shell interpretation)
- [x] T088: EC2Worker SSM — fix --parameters format for AWS CLI
- [x] T089: FileNotifier — sanitize task.id in filename to prevent path traversal

## Phase 25: Operational Tooling
- [x] T090: Grafana dashboard JSON — importable model for CCC Prometheus metrics
- [x] T091: Config schema documentation — all fields, types, defaults, examples

## Phase 26: Packaging
- [x] T092: Version bump to v1.6.0, include Grafana dashboard in package files
- [x] T093: GitHub release v1.6.0 with changelog
- [x] T094: Docker image build verification (Dockerfile valid, smoke test passes)

## Phase 27: CLI Polish
- [x] T095: CLI flags — --help, --version, --validate for ops deployment scripts
- [x] T096: CLI --list-components flag — discover available component types for config authoring
- [x] T097: Version bump to v1.7.0, GitHub release

## Phase 28: Deployment Manifests
- [x] T098: K8s deployment manifests — Deployment, ConfigMap, Service, ServiceMonitor

## Phase 29: Package & Kustomize
- [x] T099: Kustomization.yaml for kubectl apply -k, update package.json files

## Phase 30: Bug Fix & CLI

- [x] T100: Fix dedup bypass in listen callback — webhook tasks skip isDuplicate check
- [x] T101: CLI --dry-run flag — run one cycle, log actions, exit without executing workers
- [x] T102: CLI --status flag — read state/ directory, print queue/metrics without starting
- [x] T103: Fix --status requiring config arg — move before configPath check
- [x] T104: Version bump to v1.8.0, GitHub release
- [x] T105: GitHubInput execFileSync — eliminate shell injection vector in gh CLI call

## Phase 31: Container Security
- [x] T106: Dockerfile non-root user + K8s securityContext (runAsNonRoot, readOnlyRootFilesystem)

## Phase 32: Operational Tooling
- [x] T107: Healthcheck script — standalone ops tool to probe running manager (healthz/readyz/metrics)
- [x] T108: PersistentVolumeClaim for state — survive pod restarts, optional emptyDir fallback

## Phase 33: Test Suite Reliability
- [x] T109: Fix healthPort 0 treated as falsy — use ?? instead of || in startHealth()
- [x] T110: Fix test-notifiers libuv crash — delay process.exit for socket drain on Windows
- [x] T111: Fix test-hot-reload-prom queue pollution — clear shared state before Prometheus test

## Phase 34: K8s Network Security
- [x] T112: NetworkPolicy — restrict ingress to health/metrics port, controlled egress (DNS, HTTPS, K8s API)

## Phase 35: Test Reliability (continued)
- [x] T113: Fix test-hot-reload-prom exit — delay process.exit for libuv drain on Windows
- [x] T114: Apply libuv drain fix to remaining test files (dispatch, e2e-bridge, inputs)
- [x] T115: Fix run-all.js suite failure counting — distinguish libuv crash from test failure
- [x] T116: Apply libuv drain fix to all 11 remaining test files
- [x] T117: Version bump to v1.9.0, GitHub release

## Phase 36: Packaging & Adoption
- [x] T118: Add healthcheck and validate scripts to package.json + files array
- [x] T119: Test runner — show suite names in output for debugging
- [x] T120: CHANGELOG.md — summarize all phases for consumers
- [x] T121: Dockerfile — only copy example.yaml, not project-specific configs
- [x] T122: Version bump to v1.10.0, GitHub release

## Phase 37: CI, Docs & Cleanup
- [x] T123: GitHub Actions test CI — run npm test on push/PR
- [x] T124: README.md — project overview, quickstart, architecture, component table
- [x] T125: Dockerfile — add Grafana dashboard to COPY
- [x] T126: Clean up stale branches (local + remote merged branches)
- [x] T127: Add GitHub input to rone-teams-poller.yaml for SELF_REPAIR issues

## Phase 38: CI Fix & Release
- [x] T128: Fix secret-scan self-match — add file type filters to PRIVATE KEY grep
- [x] T129: Version bump to v1.11.0, GitHub release with CHANGELOG update

## Phase 39: Multi-Instance Support
- [x] T130: Per-instance state isolation — each Manager uses state/<name>/ directory
- [x] T131: Instance-labeled Prometheus metrics — add {instance="name"} labels
- [x] T132: Multi-config CLI — accept multiple config files, shared signal handling
- [x] T133: Aggregated health endpoint — single HTTP server for all instances
- [x] T134: Multi-instance test suite — verify isolated state, merged metrics, shared health

## Phase 40: Rules → Hook Modules Migration
- [x] T135: Archive project .claude/rules/, migrate content to hook modules + CLAUDE.md

## Phase 41: Code Review & Polish
- [x] T136: DRY — MultiManager.start() delegates to Manager.start() instead of duplicating logic
- [x] T137: README — document multi-instance CLI usage, MultiManager API
- [x] T138: Version bump to v1.13.0, GitHub release

## Phase 42: Helm Chart & Deployment
- [x] T139: Helm chart — template all K8s manifests with configurable values
- [x] T140: RONE values overlay — values-rone.yaml for hackathon-teams-poller deployment
- [x] T141: Helm chart test — validate templates render correctly with default and RONE values
- [x] T142: Version bump to v1.14.0, update package.json files array, GitHub release

## Phase 43: Runtime Improvements
- [x] T143: Task sharding — dispatcher splits plans into parallel sub-tasks across multiple workers
- [x] T144: Event-driven bridge — fs.watch for instant task pickup instead of polling interval
- [x] T145: Version bump to v1.15.0, GitHub release

## Related Projects
- `rone-teams-poller` — chat adapter, routes SELF_REPAIR to this manager
- `claude-portable` — worker image, executes individual tasks
- `hook-runner` — SHTD enforcement hooks baked into worker image

## Gotchas
- RONE K8s pods don't have git — use git bridge or image with git baked in
- K8s ConfigMap scripts can't import from each other — keep self-contained or use proper image
- kubeconfig expires every 8h — auto-refresh via Blueprint or RONE API
- gh auth switch broken with EMU — use gh_auto (reads publish.json, sets GH_TOKEN)
- YAML parser handles any nesting depth, quoted strings, object lists (not inline flow or multiline strings)
- Branch gate requires task branch (NNN-TNNN-slug), not just feature branch
- Feature branch needs .test-results/<branch-name>.passed marker to merge to main
