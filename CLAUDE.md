# CCC Manager

Universal fleet manager for CCC (Continuous Claude Code) deployments. Same engine, different config per project.

## Architecture

```
Manager Runtime (src/index.js)
├── Monitors (src/monitors/)     — detect issues (pod health, log errors, metrics)
├── Inputs (src/inputs/)         — receive tasks (bridge, SSH, GitHub issues, alerts)
├── Dispatcher (src/dispatcher/) — analyze, spec, plan, distribute to workers
├── Verifiers (src/verifiers/)   — confirm fixes (test suite, health check, manual)
└── State (src/state.js)         — persist queue, history, metrics
```

## Config

Each managed project has a YAML config in `config/`. Fields:
- `name` — project identifier
- `interval` — check cycle interval in ms
- `monitors` — what to watch (type, thresholds)
- `inputs` — task sources (type, path/url)
- `dispatcher` — how to plan/distribute (type)
- `verifiers` — how to verify fixes (type, command)

## Running

```bash
node src/index.js config/example.yaml
```

## Testing

```bash
npm test                          # All 19+ suites (511+ tests)
node scripts/test/run-all.js      # Same thing
node scripts/test/test-scaffold.js  # Core framework only
```

## Built-in Components

| Type | Name | Description |
|------|------|-------------|
| Monitor | `process` | Run command, report if exit != 0 |
| Monitor | `log` | Tail file, match regex patterns |
| Input | `bridge` | Poll directory for .json task files |
| Input | `alert` | In-memory queue (monitor→dispatcher) |
| Input | `github` | Poll GitHub issues by label via gh CLI |
| Dispatcher | `shtd` | Analyze issue → SHTD spec/tasks |
| Dispatcher | `claude` | AI-powered spec generation via claude -p |
| Verifier | `test-suite` | Run command, pass if exit 0 |
| Worker | `local` | Execute via child_process |
| Worker | `k8s` | Execute via kubectl exec |
| Worker | `ec2` | Execute via SSH, SSM, or local |
| Input | `webhook` | HTTP POST endpoint with HMAC auth |
| Notifier | `webhook` | Post results to Teams/Slack/JSON |
| Notifier | `file` | Write results to disk as JSON files |
| Monitor | `cron` | Run checks on independent cron schedule |
| Input | `sqs` | Receive tasks from AWS SQS queue |
| Dispatcher | `sqs` | Distribute sharded work via SQS task/result queues |
| Utility | `sharder` | Split tasks across dimensions (cartesian/chunk/round-robin) |

## Docker

```bash
docker build -t ccc-manager .
docker run ccc-manager config/rone-teams-poller.yaml
```

## Key Design Decisions

- Zero npm dependencies — Node.js built-ins only
- ESM modules throughout
- Registry pattern for pluggable components
- State persists to disk (gitignored) for crash recovery
- Environment-agnostic: same code for K8s, EC2, or local
- Dedup prevents same issue from being re-enqueued within 1 hour
