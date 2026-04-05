# 018: Multi-Agent SHTD Coordination

## Problem
Multiple agents (Claude tabs, CCC workers) on the same repo collide on files, tasks, state, and branches. Task claiming (T170) solves duplicate task pickup but doesn't prevent file conflicts or provide fleet visibility.

## Solution: Four Coordination Layers

```
Layer 4: Fleet Oversight    — Managers monitor all nodes, rebalance, report
Layer 3: Write Set Guards   — Dispatcher rejects plans with overlapping file targets
Layer 2: Worktree Isolation — Each agent works in its own git worktree
Layer 1: Task Claims        — Atomic claim files prevent duplicate task pickup (T170)
```

## Design

### WorktreeManager (src/workers/worktree.js)
- `create(taskId)` — `git worktree add .worktrees/<taskId> -b fix/<taskId>`
- `destroy(taskId)` — remove worktree after merge/abandon
- `list()` — active worktrees with task IDs
- Workers call this instead of operating in shared working dir

### Write Set Validation (src/dispatcher/write-sets.js)
- `validateWriteSets(plan)` — adds `dependsOn` edges where write sets overlap
- Supports glob patterns (`src/inputs/*.js`)
- Slots into existing `dispatch()` which already respects `dependsOn`

### FleetCoordinator (src/fleet.js)
- `heartbeat()` — writes manager status to `state/fleet/<workerId>.json`
- `peers()` — reads all status files, returns active managers
- `isTaskOwnedByPeer(taskId)` — checks peer status files
- `staleWorkers()` — peers with heartbeat older than threshold
- Exposed via `/fleet` health endpoint
