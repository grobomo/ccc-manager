// Auto-registration of all built-in components.

import { BridgeInput } from './inputs/bridge.js';
import { AlertInput } from './inputs/alert.js';
import { ProcessMonitor } from './monitors/process.js';
import { LogMonitor } from './monitors/log.js';
import { CronMonitor } from './monitors/cron.js';
import { GitHubInput } from './inputs/github.js';
import { WebhookInput } from './inputs/webhook.js';
import { SHTDDispatcher } from './dispatcher/shtd.js';
import { ClaudeDispatcher } from './dispatcher/claude.js';
import { SQSDispatcher } from './dispatcher/sqs.js';
import { SQSInput } from './inputs/sqs.js';
import { TestSuiteVerifier } from './verifiers/test-suite.js';
import { LocalWorker } from './workers/local.js';
import { K8sWorker } from './workers/k8s.js';
import { EC2Worker } from './workers/ec2.js';
import { WebhookNotifier } from './notifiers/webhook.js';
import { FileNotifier } from './notifiers/file.js';

export function registerBuiltins(registry) {
  registry.registerInput('bridge', BridgeInput);
  registry.registerInput('alert', AlertInput);
  registry.registerInput('github', GitHubInput);
  registry.registerInput('webhook', WebhookInput);
  registry.registerInput('sqs', SQSInput);
  registry.registerMonitor('process', ProcessMonitor);
  registry.registerMonitor('log', LogMonitor);
  registry.registerMonitor('cron', CronMonitor);
  registry.registerDispatcher('shtd', SHTDDispatcher);
  registry.registerDispatcher('claude', ClaudeDispatcher);
  registry.registerDispatcher('sqs', SQSDispatcher);
  registry.registerVerifier('test-suite', TestSuiteVerifier);
  registry.registerWorker('local', LocalWorker);
  registry.registerWorker('k8s', K8sWorker);
  registry.registerWorker('ec2', EC2Worker);
  registry.registerNotifier('webhook', WebhookNotifier);
  registry.registerNotifier('file', FileNotifier);
}
