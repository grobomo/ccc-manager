# CCC Manager — TODO

## Session Handoff

**From**: rone-teams-poller session (2026-04-05)
**Context**: User wants a universal "manager" framework for CCC fleets. Same engine, different config per project. Monitors health, accepts input (Teams/SSH/GitHub issues), dispatches fixes via SHTD pipeline, verifies results.

**User requirements (verbatim from conversation):**
1. Self-repair should be generic enough to use in any project — abstract to high level, make modular
2. Workers should NOT decide how to do things — dispatcher decides, specs it out, distributes spec tasks to workers
3. Two CCC fleets: RONE (K8s) for RONE tasks, AWS (EC2) for AWS tasks — same codebase
4. All capabilities must work in all environments (AWS + K8s)
5. Dispatcher is point of contact for each fleet — constantly running, waiting for tasks from Teams poller or SSH
6. Deploy SHTD workflow to CCC worker golden image
7. Abstract the monitor role and self-repair role into a "manager" role that can modularly hook into any project
8. Same functionality in every project — just monitoring and repairing different things

**Architecture decided:**
- Manager = Monitor + Input Sources + Dispatcher + Verifier + State
- Per-project config via `manager.yaml` (monitors, inputs, verify command, deploy command, alerts)
- Environment-agnostic: AWS EC2, RONE K8s, or local
- Dispatcher is the brain (specs, plans, distributes). Workers are hands (execute single tasks with SHTD hooks).
- Self-repair is a dispatcher capability, not a worker skill

## Phase 1: Core Framework (COMPLETE)
- [x] T001: Project scaffold — package.json, .gitignore, .github/publish.json, CLAUDE.md, src/
- [x] T002: Base classes — Monitor, Input, Dispatcher, Verifier in src/base.js
- [x] T003: Config loader — minimal YAML parser in src/config.js
- [x] T004: Registry — type→class mapping in src/registry.js
- [x] T005: State persistence — queue/history/metrics in src/state.js
- [x] T006: Manager runtime — main loop, init, runCycle, start/stop in src/index.js
- [x] T007: Example config — config/example.yaml
- [x] Checkpoint: 22/22 tests pass (scripts/test/test-scaffold.js)

## Phase 2: Input Sources (COMPLETE)
- [x] T008: BridgeInput — polls directory for .json task files, moves to done/
- [x] T009: AlertInput — in-memory queue for monitor→dispatcher pipeline
- [x] T010: ProcessMonitor — generic health check (command exit code)
- [x] T011: Auto-registration — builtins.js registers all components
- [x] T012: Checkpoint: 18/18 tests pass (scripts/test/test-inputs.js)

## Phase 3: Worker Distribution (COMPLETE)
- [x] T013: SHTDDispatcher — analyze → spec/tasks/branch structure
- [x] T014: TestSuiteVerifier — command-based verification
- [x] T015: Worker base class — execute/status/cancel interface
- [x] T016: LocalWorker — child_process execution for dev/test
- [x] T017: Builtins registration for dispatcher + verifier
- [x] T018: Checkpoint: 15/15 tests pass (scripts/test/test-dispatch.js)

## Phase 4: Per-Project Configs (COMPLETE)
- [x] T019: rone-teams-poller.yaml — process monitor + bridge input + test-suite verifier
- [x] T020: claude-portable.yaml — process monitor + test-suite verifier
- [x] T021: Checkpoint: 16/16 tests pass (scripts/test/test-pipeline.js)
- [x] All 71 tests pass across 4 suites

## Related Projects
- `rone-teams-poller` — chat adapter, routes SELF_REPAIR to this manager
- `claude-portable` — worker image, executes individual tasks
- `hook-runner` — SHTD enforcement hooks baked into worker image

## Gotchas
- RONE K8s pods don't have git — use git bridge or image with git baked in
- K8s ConfigMap scripts can't import from each other — keep self-contained or use proper image
- kubeconfig expires every 8h — auto-refresh via Blueprint or RONE API
- Two GitHub accounts (grobomo=public, tmemu=private) — check publish.json before push
