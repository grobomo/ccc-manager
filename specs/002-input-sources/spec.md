# Spec 002: Input Sources

## Problem
The manager runtime has base classes but no concrete implementations. It needs real input sources to receive tasks from the outside world — git bridge (K8s PVC), health alerts (from monitors), and GitHub issues.

## Solution
Implement three Input subclasses:
1. **BridgeInput** — polls a directory for JSON task files (used by rone-teams-poller to send SELF_REPAIR tasks via PVC/git bridge)
2. **AlertInput** — internal input that monitors can push alerts into (threshold exceeded → task)
3. **GitHubInput** — polls GitHub issues with a specific label for tasks

Also implement the first concrete Monitor:
4. **ProcessMonitor** — checks if a command succeeds (generic health check)

## Scope
- src/inputs/bridge.js, alert.js, github.js
- src/monitors/process.js
- Registration in registry
- E2E test with bridge input

## Out of Scope
- SSH input (Phase 2 stretch)
- Worker distribution
