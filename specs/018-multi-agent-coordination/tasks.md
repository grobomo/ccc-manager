# Tasks: 018 Multi-Agent SHTD Coordination

- [x] T171: WorktreeManager — create/destroy/list git worktrees for task isolation
- [x] T172: Write set validation — validateWriteSets() adds dependsOn for overlapping file targets
- [x] T173: Wire write sets into ClaudeDispatcher — AI prompt includes writeSet in output format
- [x] T174: Wire write sets into base Dispatcher.dispatch() — call validateWriteSets before execution
- [x] T175: FleetCoordinator — heartbeat, peer discovery, task ownership check
- [x] T176: Wire fleet into Manager — heartbeat on each cycle, /fleet endpoint, deregister on stop
- [x] T177: Wire fleet into dequeue — skip tasks owned by peers (supplements claim files)
- [x] T178: Tests — write set overlap (22 tests), fleet heartbeat/discovery/stale/prune (12 tests)
- [ ] T179: Integration test — two simulated managers with fleet coordination, no conflicts
- [ ] T180: Version bump, CHANGELOG, README update
