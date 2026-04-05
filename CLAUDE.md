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
node scripts/test/test-scaffold.js
```

## Key Design Decisions

- Zero npm dependencies — Node.js built-ins only
- ESM modules throughout
- Registry pattern for pluggable components
- State persists to disk (gitignored) for crash recovery
- Environment-agnostic: same code for K8s, EC2, or local
