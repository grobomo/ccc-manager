#!/usr/bin/env node

// E2E test: dispatcher analyzes issue, local worker executes, verifier confirms.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function main() {
  console.log('=== CCC Manager Dispatch Test ===\n');

  // 1. Test SHTDDispatcher
  console.log('1. Testing SHTDDispatcher...');
  const { SHTDDispatcher } = await import('../../src/dispatcher/shtd.js');
  assert(typeof SHTDDispatcher === 'function', 'SHTDDispatcher exported');

  const dispatcher = new SHTDDispatcher({ projectDir: ROOT });
  const issue = {
    id: 'test-issue-1',
    severity: 'high',
    summary: 'Process health check failed',
    details: { command: 'node -e "process.exit(1)"', exitCode: 1 }
  };

  const plan = await dispatcher.analyze(issue);
  assert(plan !== null, 'Dispatcher produced a plan');
  assert(plan.spec !== undefined, 'Plan has spec field');
  assert(Array.isArray(plan.tasks), 'Plan has tasks array');
  assert(plan.tasks.length > 0, `Plan has ${plan.tasks.length} task(s)`);
  assert(plan.issue === issue, 'Plan references original issue');

  // 2. Test TestSuiteVerifier
  console.log('\n2. Testing TestSuiteVerifier...');
  const { TestSuiteVerifier } = await import('../../src/verifiers/test-suite.js');
  assert(typeof TestSuiteVerifier === 'function', 'TestSuiteVerifier exported');

  const passVerifier = new TestSuiteVerifier('pass-check', { command: 'node -e "process.exit(0)"' });
  const passResult = await passVerifier.verify({}, {});
  assert(passResult.passed === true, 'Passing command verifies true');

  const failVerifier = new TestSuiteVerifier('fail-check', { command: 'node -e "process.exit(1)"' });
  const failResult = await failVerifier.verify({}, {});
  assert(failResult.passed === false, 'Failing command verifies false');

  // 3. Test Worker base + LocalWorker
  console.log('\n3. Testing LocalWorker...');
  const { LocalWorker } = await import('../../src/workers/local.js');
  assert(typeof LocalWorker === 'function', 'LocalWorker exported');

  const worker = new LocalWorker({ shell: true });

  // Execute a simple task
  const taskResult = await worker.execute({
    id: 'task-1',
    command: 'node -e "console.log(JSON.stringify({status: \'done\'}))"'
  });
  assert(taskResult.success === true, 'LocalWorker executed task successfully');
  assert(taskResult.output.includes('done'), 'Task output contains expected data');

  // Execute a failing task
  const failTaskResult = await worker.execute({
    id: 'task-2',
    command: 'node -e "process.exit(42)"'
  });
  assert(failTaskResult.success === false, 'LocalWorker reports failure for bad exit code');

  // 4. Test dispatch with worker integration
  console.log('\n4. Testing dispatch → worker wiring...');
  const dispResult = await dispatcher.dispatch(plan, { dispatcher: { worker: 'default' } }, { default: worker });
  assert(dispResult.planId === plan.spec.id, 'Dispatch result has planId');
  assert(dispResult.taskCount === plan.tasks.length, `Dispatch handled ${dispResult.taskCount} tasks`);
  assert(dispResult.status === 'completed' || dispResult.status === 'partial', `Dispatch status: ${dispResult.status}`);
  assert(Array.isArray(dispResult.results), 'Dispatch has results array');
  assert(dispResult.results.length === plan.tasks.length, 'Result per task');

  // Test dispatch with no workers (graceful fallback)
  const noWorkerResult = await dispatcher.dispatch(plan, {}, {});
  assert(noWorkerResult.status === 'completed', 'No-worker dispatch completes gracefully');
  assert(noWorkerResult.results[0].skipped === true, 'Tasks marked as skipped without worker');

  // 5. Test registration
  console.log('\n5. Testing registration...');
  const { Registry } = await import('../../src/registry.js');
  const { registerBuiltins } = await import('../../src/builtins.js');
  const reg = new Registry();
  registerBuiltins(reg);

  assert(reg.getDispatcher('shtd') !== null, 'SHTDDispatcher registered');
  assert(reg.getVerifier('test-suite') !== null, 'TestSuiteVerifier registered');

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
