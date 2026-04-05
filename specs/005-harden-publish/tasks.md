# Tasks: 005 Harden & Publish

## Phase 1: Bug Fixes

- [x] T022: Fix metrics.issues persistence — save after increment
- [x] T023: Add dedup to runCycle — skip enqueue if issue.id already in queue or recent history
- [x] T024: Add secret-scan.yml GitHub Actions workflow
- [x] T025: Configure git local config for grobomo account
- [ ] T026: Initial commit and push to grobomo/ccc-manager

**Checkpoint**: `node scripts/test/test-pipeline.js` — all existing tests still pass after fixes
