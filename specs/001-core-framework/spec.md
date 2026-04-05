# Spec 001: Core Framework

## Problem
CCC fleets (RONE K8s, AWS EC2) need a universal manager that monitors health, accepts input from multiple sources, dispatches fixes via SHTD pipeline, and verifies results. Currently each project has ad-hoc monitoring — no reusable framework.

## Solution
Build a modular manager runtime with pluggable components:
- **Monitors** — detect issues (pod health, log errors, metrics thresholds)
- **Inputs** — receive tasks (git bridge, SSH, GitHub issues, health alerts)
- **Dispatcher** — analyze issues, create SHTD specs, distribute to workers
- **Verifiers** — confirm fixes (test suites, health checks)
- **State** — persist queue, history, metrics

Per-project config via YAML. Zero npm dependencies — Node.js built-ins only.

## Scope
- Project scaffold with base classes
- Manager runtime (main loop, config loading)
- State persistence
- Registry for component types
- Example config

## Out of Scope
- Specific monitor/input/verifier implementations (Phase 2+)
- Worker distribution (Phase 3)
- Per-project configs (Phase 4)
