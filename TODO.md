# CCC Manager — TODO

## Session Handoff (2026-04-05, session 2)

**What was done this session:**
- Built entire framework from scratch: 8 specs, 39 tasks, all complete
- 108 tests across 6 suites, 0 failures
- Published to grobomo/ccc-manager (7 PRs merged)
- Created `gh_auto` script + enforcement hook (fixes EMU token issue)
- Installed gh_auto to ~/bin, hook to ~/.claude/hooks/run-modules/PreToolUse/gh-auto-gate.js
- Rule file at ~/.claude/rules/gh-auto-required.md

**Current state:** On main branch, all merged, clean working tree.

## Completed Phases (1-8)
- Phase 1: Core framework (base classes, config, registry, state, runtime)
- Phase 2: Input sources (BridgeInput, AlertInput, ProcessMonitor)
- Phase 3: Worker distribution (SHTDDispatcher, TestSuiteVerifier, LocalWorker)
- Phase 4: Per-project configs (rone-teams-poller.yaml, claude-portable.yaml)
- Phase 5: Harden & publish (dedup, metrics fix, secret-scan CI, git config)
- Phase 6: Environment workers (K8sWorker, EC2Worker, LogMonitor, GitHubInput)
- Phase 7: Deploy & integrate (Dockerfile, unified test runner, docs)
- Phase 8: gh_auto (auto GitHub account switching, enforcement hook)

## Components (10 built-in)
| Type | Name | File |
|------|------|------|
| Monitor | process | src/monitors/process.js |
| Monitor | log | src/monitors/log.js |
| Input | bridge | src/inputs/bridge.js |
| Input | alert | src/inputs/alert.js |
| Input | github | src/inputs/github.js |
| Dispatcher | shtd | src/dispatcher/shtd.js |
| Verifier | test-suite | src/verifiers/test-suite.js |
| Worker | local | src/workers/local.js |
| Worker | k8s | src/workers/k8s.js |
| Worker | ec2 | src/workers/ec2.js |

## Phase 9: Harden Runtime
- [x] T040: YAML parser — quoted strings, object lists, 31 regression tests
- [x] T041: Graceful shutdown — drain queue on SIGTERM with configurable timeout
- [ ] T042: Wire real rone-teams-poller SELF_REPAIR → bridge directory integration
- [x] T043: Health endpoint — /healthz, /readyz, /metrics for K8s probes
- [ ] T044: Publish as npm package or emu marketplace plugin
- [ ] T045: Demo: run manager against a real config, show monitor→dispatch→verify cycle

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
