// Auto-registration of all built-in components.

import { BridgeInput } from './inputs/bridge.js';
import { AlertInput } from './inputs/alert.js';
import { ProcessMonitor } from './monitors/process.js';
import { SHTDDispatcher } from './dispatcher/shtd.js';
import { TestSuiteVerifier } from './verifiers/test-suite.js';

export function registerBuiltins(registry) {
  registry.registerInput('bridge', BridgeInput);
  registry.registerInput('alert', AlertInput);
  registry.registerMonitor('process', ProcessMonitor);
  registry.registerDispatcher('shtd', SHTDDispatcher);
  registry.registerVerifier('test-suite', TestSuiteVerifier);
}
