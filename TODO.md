# CCC Manager — TODO

## Session Handoff (2026-04-05, session 9)

**What was done this session:**
- T072: Updated rone-teams-poller.yaml to use claude dispatcher
- T073: E2E integration test — bridge → claude dispatcher (fallback) → local worker → verifier (19 tests)
- T074: Fixed marketplace PR #76 Copilot review comments (SKILL.md frontmatter, counts)
- 271 tests across 13 suites, 0 failures, 32 PRs merged

**Current state:** v1.4.0 on main. 17 components, 294 tests across 14 suites, 34 PRs merged.
**Marketplace PR:** https://github.com/trend-ai-taskforce/ai-skill-marketplace/pull/76 (open, Copilot comments addressed)

**Next priorities (zoom out):**
- Consider a `cron` monitor type for scheduled health checks vs fixed interval
- Add a `file` notifier (write results to disk for bridge consumption)
- Real integration with rone-teams-poller: test with actual RONE bridge files from K8s PVC

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
