# Tasks: 002 Input Sources

## Phase 1: Bridge & Alert Inputs

- [x] T008: BridgeInput — polls directory for .json task files, moves processed to done/
- [x] T009: AlertInput — in-memory queue that monitors push into, poll() drains it
- [x] T010: ProcessMonitor — runs a command, reports issue if exit code != 0
- [x] T011: Auto-registration — index files that register all built-in components with Registry
- [x] T012: Integration test — bridge writes task file, manager picks it up, processes it

**Checkpoint**: `node scripts/test/test-inputs.js` — creates temp dir with task JSON, runs manager cycle, verifies task was dequeued and processed
