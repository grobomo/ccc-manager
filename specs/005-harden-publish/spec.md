# Spec 005: Harden & Publish

## Problem
Code review found bugs and missing infrastructure:
1. `metrics.issues++` bypasses `_save()` — issues count not persisted
2. Same monitor issue re-enqueued every cycle (no dedup)
3. Missing `.github/workflows/secret-scan.yml` (required by push workflow)
4. No git local config (required for grobomo repos)
5. No initial commit — project not on GitHub yet

## Solution
Fix bugs, add secret-scan CI, configure git, commit, and push to grobomo.
