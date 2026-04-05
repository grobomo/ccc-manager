# Tasks: 001 Core Framework

## Phase 1: Scaffold & Base

- [x] T001: Project scaffold — package.json, .gitignore, .github/publish.json, CLAUDE.md, directory structure
- [x] T002: Base classes — Monitor, Input, Dispatcher, Verifier in src/base.js
- [x] T003: Config loader — minimal YAML parser, loadConfig/loadProjectConfig in src/config.js
- [x] T004: Registry — type→class mapping for all component types in src/registry.js
- [x] T005: State persistence — queue/history/metrics in src/state.js
- [x] T006: Manager runtime — main loop, init, runCycle, start/stop in src/index.js
- [x] T007: Example config — config/example.yaml showing all supported fields

**Checkpoint**: `node scripts/test/test-scaffold.js` — imports all modules, creates a Manager with example config, runs one cycle, verifies state files created
