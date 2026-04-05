# CCC Manager

Universal fleet manager for Continuous Claude Code (CCC) deployments. Monitors health, accepts input from multiple sources, dispatches AI-powered repair plans, and verifies fixes — all with zero npm dependencies.

## Quick Start

```bash
# Run with a project config
node src/index.js config/example.yaml

# Or via npm
npm start -- config/example.yaml

# Validate config without starting
node src/index.js --validate config/example.yaml

# Check status of a running instance
node src/index.js --status

# Dry-run: one cycle, no worker execution
node src/index.js --dry-run config/example.yaml
```

## Architecture

```
Manager Runtime (src/index.js)
├── Monitors     — detect issues (pod health, log errors, cron checks)
├── Inputs       — receive tasks (bridge files, GitHub issues, webhooks)
├── Dispatcher   — analyze + plan (AI via claude -p, or structured fallback)
├── Workers      — execute tasks (local shell, kubectl exec, SSH/SSM)
├── Verifiers    — confirm fixes (test suite runner)
├── Notifiers    — report results (Teams/Slack webhook, file output)
└── State        — persist queue, history, metrics to disk
```

## Components (17 built-in)

| Type | Name | Description |
|------|------|-------------|
| Monitor | `process` | Run command, report if exit != 0 |
| Monitor | `log` | Tail file, match regex patterns |
| Monitor | `cron` | Run checks on independent cron schedule |
| Input | `bridge` | Poll directory for JSON task files |
| Input | `alert` | In-memory queue (monitor to dispatcher) |
| Input | `github` | Poll GitHub issues by label via gh CLI |
| Input | `webhook` | HTTP POST endpoint with HMAC auth |
| Dispatcher | `shtd` | Structured fallback (investigate + verify) |
| Dispatcher | `claude` | AI-powered spec generation via `claude -p` |
| Verifier | `test-suite` | Run command, pass if exit 0 |
| Worker | `local` | Execute via child_process |
| Worker | `k8s` | Execute via kubectl exec |
| Worker | `ec2` | Execute via SSH or AWS SSM |
| Notifier | `webhook` | Post results to Teams/Slack/JSON endpoint |
| Notifier | `file` | Write results to disk as JSON files |

## Configuration

Each managed project has a YAML config. See `config/example.yaml` for all options.

```yaml
name: my-project
interval: 30000
healthPort: 8080

monitors:
  pod-health:
    type: process
    command: kubectl get pods --no-headers | grep -v Running

inputs:
  tasks:
    type: bridge
    path: /data/bridge/pending
    completedDir: /data/bridge/completed

dispatcher:
  type: claude
  timeout: 60000

verifiers:
  tests:
    type: test-suite
    command: npm test

workers:
  default:
    type: k8s
    namespace: my-namespace
    pod: worker-pod

notifiers:
  teams:
    type: webhook
    url: https://outlook.office.com/webhook/...
    format: teams

maxRetries: 2
```

## Observability

- **Health endpoints**: `/healthz`, `/readyz`, `/metrics` (Prometheus text format)
- **Grafana dashboard**: `config/grafana-dashboard.json` (importable)
- **Structured logging**: Set `logFormat: json` or `CCC_LOG_FORMAT=json`
- **Hot-reload**: Config changes to interval, maxRetries, dedupWindow apply at runtime
- **SIGHUP**: Trigger config reload (K8s ConfigMap update pattern)

## Kubernetes Deployment

```bash
# Deploy with Kustomize
kubectl apply -k k8s/

# Or individual manifests
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/networkpolicy.yaml
```

Includes: Deployment with security context (non-root, read-only root filesystem, dropped capabilities), PVC for state persistence, NetworkPolicy for traffic restriction, ServiceMonitor for Prometheus.

## Docker

```bash
docker build -t ccc-manager .
docker run -v ./my-config.yaml:/app/config/project.yaml ccc-manager config/project.yaml
```

## CLI

```
ccc-manager <config.yaml> [options]

Options:
  --validate        Validate config and exit
  --dry-run         Run one cycle, log actions, exit without workers
  --status          Print queue/metrics from state/ directory
  --list-components List available component types
  --version         Print version
  --help            Show help
```

## Plugin System

Custom components can be loaded from file paths:

```yaml
monitors:
  custom:
    type: ./plugins/my-monitor.js
```

The plugin file should export a class extending the appropriate base class from `ccc-manager/base`.

## Testing

```bash
npm test    # 15 suites, 359 tests
```

## License

MIT
