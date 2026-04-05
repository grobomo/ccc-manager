# Spec: 016 Worker Task Claims (Multi-Worker Coordination)

## Problem

When multiple workers operate on the same repo/queue simultaneously, they collide:
- Both pick the same task from the queue
- Both create branches with overlapping names
- Both edit shared files (TODO.md, CHANGELOG, package.json)
- One worker's merge invalidates the other's branch

This was observed firsthand with two Claude Code tabs on ccc-manager — wasted cycles
resolving conflicts, stale branches, and duplicate work.

## Solution: Atomic Task Claims

Add a claim protocol to State that prevents two workers from working the same task:

1. **`claim(taskId, workerId)`** — atomically mark a task as claimed by a specific worker.
   Returns true if claimed successfully, false if already claimed by another worker.
   Uses file-based locking (write `claims/<taskId>.json` with workerId + timestamp).

2. **`release(taskId, workerId)`** — release a claim (on completion or timeout).

3. **`isClaimed(taskId)`** — check if a task is already claimed.

4. **Claim expiry** — claims older than `claimTimeout` (default 10min) auto-expire,
   so crashed workers don't permanently lock tasks.

5. **`dequeue()` respects claims** — skips tasks claimed by other workers.

## Integration

- Each Manager instance gets a `workerId` (config field or auto-generated UUID)
- `_processTask()` claims before processing, releases on completion
- MultiManager instances automatically get distinct workerIds
- Compatible with external workers (K8s pods, EC2 instances) via shared state dir
