# Tasks: 006 Environment Workers

## Phase 1: Workers & Extended Components

- [x] T027: K8sWorker — dispatch via kubectl exec, configurable namespace/pod/container
- [x] T028: EC2Worker — dispatch via ssh or aws ssm send-command
- [x] T029: LogMonitor — tail a file, match regex patterns, emit issues
- [x] T030: GitHubInput — poll issues via gh CLI, filter by label
- [x] T031: Register all new components in builtins.js
- [x] T032: Tests for new components (mocked external commands)

**Checkpoint**: `node scripts/test/test-workers.js` — verifies K8s/EC2 workers handle success/failure, log monitor matches patterns, GitHub input parses issues
