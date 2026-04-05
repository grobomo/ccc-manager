# Spec 004: Per-Project Configs

## Problem
The framework is built but has no real project configurations. Need concrete manager.yaml files for the target projects.

## Solution
Create config files for each managed project + a full end-to-end integration test that exercises the complete pipeline: monitor → detect → enqueue → dispatch → execute → verify.

## Scope
- config/rone-teams-poller.yaml — K8s pod health, bridge input
- config/claude-portable.yaml — self-managing golden image
- Full pipeline integration test
