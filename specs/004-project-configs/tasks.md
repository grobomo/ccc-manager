# Tasks: 004 Per-Project Configs

## Phase 1: Configs & Integration

- [x] T019: rone-teams-poller.yaml — process monitor + bridge input + test-suite verifier
- [x] T020: claude-portable.yaml — process monitor + test-suite verifier
- [x] T021: Full pipeline integration test — monitor detects issue → dispatcher plans → worker executes → verifier confirms

**Checkpoint**: `node scripts/test/test-pipeline.js` — end-to-end: config loads, monitor fires, task flows through dispatcher and verifier
