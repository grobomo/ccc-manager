# Spec 003: Worker Distribution

## Problem
The manager can detect issues and receive tasks, but has no way to actually fix them. The dispatcher needs to analyze issues, create SHTD-compatible specs, and distribute tasks to CCC workers.

## Solution
1. **SHTDDispatcher** — the brain that analyzes issues and creates spec/tasks.md files
2. **TestSuiteVerifier** — runs a command to verify fixes
3. **WorkerInterface** — abstract interface for dispatching to K8s Jobs or EC2 instances
4. **LocalWorker** — executes tasks locally (for testing and single-node deployments)

## Design
- Dispatcher.analyze() creates a spec structure: { spec, tasks, branch }
- Dispatcher.dispatch() sends each task to a worker via WorkerInterface
- WorkerInterface is environment-agnostic — LocalWorker for dev, K8sWorker/EC2Worker for prod
- Verifier runs after all tasks complete to confirm the fix

## Scope
- src/dispatcher/shtd.js — SHTD spec generator
- src/verifiers/test-suite.js — command-based verification
- src/workers/local.js — local task execution
- src/workers/base.js — worker interface
