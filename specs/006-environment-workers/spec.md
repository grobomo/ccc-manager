# Spec 006: Environment Workers

## Problem
LocalWorker only runs tasks in the same process. Real deployments need to dispatch to K8s pods (kubectl exec, K8s Jobs) and EC2 instances (SSH/SSM). Also need a log monitor and GitHub issues input for broader observability.

## Solution
1. **K8sWorker** — execute via kubectl exec or create K8s Jobs
2. **EC2Worker** — execute via SSH or AWS SSM Run Command
3. **LogMonitor** — watch files/streams for error patterns via regex
4. **GitHubInput** — poll GitHub issues with a specific label
