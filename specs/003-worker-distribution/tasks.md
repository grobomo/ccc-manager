# Tasks: 003 Worker Distribution

## Phase 1: Dispatcher & Verifier

- [x] T013: SHTDDispatcher — analyze issue, produce { spec, tasks, branch } structure
- [x] T014: TestSuiteVerifier — run a shell command, pass if exit 0
- [x] T015: Worker base class — interface for dispatch/status/cancel
- [x] T016: LocalWorker — execute tasks via child_process (dev/test mode)
- [x] T017: Wire dispatcher + verifier into builtins.js registration
- [x] T018: Full integration test — issue → dispatch → local worker → verify

**Checkpoint**: `node scripts/test/test-dispatch.js` — creates an issue, dispatcher generates plan, local worker executes, verifier confirms
