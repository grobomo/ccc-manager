# CCC Manager — TODO

## Session Handoff (2026-04-05, session 5)

**What was done this session:**
- T051: Published to emu marketplace (PR #76)
- T052: Wired SHTDDispatcher to use workers for task execution
- T053: WebhookInput — HTTP POST endpoint with HMAC auth for CI/CD triggers
- T054: WebhookNotifier — posts results to Teams/Slack/JSON webhooks
- T055: Retry logic — failed tasks retry N times before permanent failure
- 203 tests across 9 suites, 0 failures, 4 PRs merged to main

**Current state:** On main branch, all Phase 11 tasks complete. 14 components, 203 tests.

## Completed Phases (1-8)
- Phase 1: Core framework (base classes, config, registry, state, runtime)
- Phase 2: Input sources (BridgeInput, AlertInput, ProcessMonitor)
- Phase 3: Worker distribution (SHTDDispatcher, TestSuiteVerifier, LocalWorker)
- Phase 4: Per-project configs (rone-teams-poller.yaml, claude-portable.yaml)
- Phase 5: Harden & publish (dedup, metrics fix, secret-scan CI, git config)
- Phase 6: Environment workers (K8sWorker, EC2Worker, LogMonitor, GitHubInput)
- Phase 7: Deploy & integrate (Dockerfile, unified test runner, docs)
- Phase 8: gh_auto (auto GitHub account switching, enforcement hook)

## Components (14 built-in)
| Type | Name | File |
|------|------|------|
| Monitor | process | src/monitors/process.js |
| Monitor | log | src/monitors/log.js |
| Input | bridge | src/inputs/bridge.js |
| Input | alert | src/inputs/alert.js |
| Input | github | src/inputs/github.js |
| Input | webhook | src/inputs/webhook.js |
| Dispatcher | shtd | src/dispatcher/shtd.js |
| Verifier | test-suite | src/verifiers/test-suite.js |
| Worker | local | src/workers/local.js |
| Worker | k8s | src/workers/k8s.js |
| Worker | ec2 | src/workers/ec2.js |
| Notifier | webhook | src/notifiers/webhook.js |

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
