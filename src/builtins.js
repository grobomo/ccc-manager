// Auto-registration of all built-in components.

import { BridgeInput } from './inputs/bridge.js';
import { AlertInput } from './inputs/alert.js';
import { ProcessMonitor } from './monitors/process.js';
import { LogMonitor } from './monitors/log.js';
import { GitHubInput } from './inputs/github.js';
import { WebhookInput } from './inputs/webhook.js';
import { SHTDDispatcher } from './dispatcher/shtd.js';
import { TestSuiteVerifier } from './verifiers/test-suite.js';
import { LocalWorker } from './workers/local.js';
import { K8sWorker } from './workers/k8s.js';
import { EC2Worker } from './workers/ec2.js';
import { WebhookNotifier } from './notifiers/webhook.js';

export function registerBuiltins(registry) {
  registry.registerInput('bridge', BridgeInput);
  registry.registerInput('alert', AlertInput);
  registry.registerInput('github', GitHubInput);
  registry.registerInput('webhook', WebhookInput);
  registry.registerMonitor('process', ProcessMonitor);
  registry.registerMonitor('log', LogMonitor);
  registry.registerDispatcher('shtd', SHTDDispatcher);
  registry.registerVerifier('test-suite', TestSuiteVerifier);
  registry.registerWorker('local', LocalWorker);
  registry.registerWorker('k8s', K8sWorker);
  registry.registerWorker('ec2', EC2Worker);
  registry.registerNotifier('webhook', WebhookNotifier);
}
